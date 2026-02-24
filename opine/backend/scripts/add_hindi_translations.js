#!/usr/bin/env node

/**
 * Add Hindi Translations to Survey Questions
 * 
 * This script adds Hindi translations to questions, descriptions, and options
 * that have English and Bengali but are missing Hindi.
 * 
 * Format: "English {Bengali{Hindi}}"
 * 
 * Creates a revert report for all changes made.
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Survey = require('../models/Survey');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SURVEY_ID = '68fd1915d41841da463f0d46';

/**
 * Parse translation format
 * Format: "English {Bengali{Hindi}}"
 */
function parseTranslation(text) {
  if (!text || typeof text !== 'string') {
    return { hasEnglish: false, hasBengali: false, hasHindi: false, languages: [] };
  }
  
  const languages = [];
  let remaining = text.trim();
  
  while (remaining.length > 0) {
    const openBraceIndex = remaining.indexOf('{');
    
    if (openBraceIndex === -1) {
      if (remaining.trim()) {
        languages.push(remaining.trim());
      }
      break;
    }
    
    const beforeBrace = remaining.substring(0, openBraceIndex).trim();
    if (beforeBrace) {
      languages.push(beforeBrace);
    }
    
    let braceCount = 0;
    let closeBraceIndex = -1;
    
    for (let i = openBraceIndex; i < remaining.length; i++) {
      if (remaining[i] === '{') {
        braceCount++;
      } else if (remaining[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          closeBraceIndex = i;
          break;
        }
      }
    }
    
    if (closeBraceIndex === -1) {
      const restText = remaining.substring(openBraceIndex + 1).trim();
      if (restText) {
        languages.push(restText);
      }
      break;
    }
    
    const insideBraces = remaining.substring(openBraceIndex + 1, closeBraceIndex);
    const nestedLanguages = parseTranslation(insideBraces);
    if (nestedLanguages.languages && nestedLanguages.languages.length > 0) {
      languages.push(...nestedLanguages.languages);
    }
    
    remaining = remaining.substring(closeBraceIndex + 1).trim();
  }
  
  const hasEnglish = languages.length > 0;
  const hasBengali = languages.length > 1;
  const hasHindi = languages.length > 2;
  
  return { hasEnglish, hasBengali, hasHindi, languages };
}

/**
 * Check if text has Bengali but missing Hindi
 */
function missingHindiTranslation(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  const parsed = parseTranslation(text);
  return parsed.hasBengali && !parsed.hasHindi;
}

/**
 * Extract English text (first language)
 */
function getEnglishText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  const openBraceIndex = text.indexOf('{');
  if (openBraceIndex === -1) {
    return text.trim();
  }
  
  return text.substring(0, openBraceIndex).trim();
}

/**
 * Extract Bengali text (second language)
 */
function getBengaliText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  const parsed = parseTranslation(text);
  if (parsed.languages.length > 1) {
    return parsed.languages[1];
  }
  return '';
}

/**
 * Add Hindi translation to text
 * Format: "English {Bengali{Hindi}}"
 */
function addHindiTranslation(text, hindiTranslation) {
  if (!text || typeof text !== 'string' || !hindiTranslation) {
    return text;
  }
  
  const parsed = parseTranslation(text);
  
  // If already has Hindi, return as is
  if (parsed.hasHindi) {
    return text;
  }
  
  // If has Bengali, add Hindi inside the last closing brace
  if (parsed.hasBengali) {
    // Find the last closing brace and insert Hindi before it
    const lastBraceIndex = text.lastIndexOf('}');
    if (lastBraceIndex !== -1) {
      return text.substring(0, lastBraceIndex) + '{' + hindiTranslation + '}' + text.substring(lastBraceIndex);
    }
    
    // Fallback: append Hindi
    return text + '{' + hindiTranslation + '}';
  }
  
  // If no Bengali, add both Bengali and Hindi (shouldn't happen in our case)
  return text + ' {' + hindiTranslation + '{' + hindiTranslation + '}}';
}

/**
 * Get Hindi translation based on English text pattern matching
 */
function getHindiTranslation(englishText, bengaliText, questionContext = '') {
  const lowerEnglish = englishText.toLowerCase().trim();
  
  // Map of English patterns to Hindi translations
  const translations = {
    // Descriptions
    'which party did you vote for in the last assembly elections': 'आपने 2021 के पिछले विधानसभा चुनावों (विधायक) में किस पार्टी को वोट दिया था?',
    'which party did you vote for in the last lok sabha elections': 'आपने 2024 के पिछले लोकसभा चुनावों (सांसद) में किस पार्टी को वोट दिया था?',
    'whom did you vote for in the by-election': '2021 के बाद आपके विधानसभा क्षेत्र (विधायक) में हुए उपचुनावों में आपने किस पार्टी को वोट दिया?',
    'if assembly elections are held tomorrow': 'यदि विधानसभा चुनाव (विधायक चुनाव) कल होते, तो आप किस पार्टी को वोट देते?',
    'if the party you chose doesn\'t contest': 'मान लीजिए कि आपकी पसंद की पार्टी आपके विधानसभा क्षेत्र में चुनाव नहीं लड़ती है, तो आप किस पार्टी को चुनेंगे?',
    'could you tell us the reason for choosing': 'क्या आप हमें बता सकते हैं कि आपने उपरोक्त पार्टी को अपने दूसरे विकल्प के रूप में क्यों चुना?',
    'how satisfied or dissatisfied are you with the mamata': 'ममता बनर्जी के नेतृत्व वाली राज्य सरकार से आप कितने संतुष्ट या असंतुष्ट हैं?',
    'how satisfied or dissatisfied are you with bjp\'s performance': 'राज्य में विरोध के रूप में भाजपा के प्रदर्शन से आप कितने संतुष्ट या असंतुष्ट हैं?',
    'how satisfied or dissatisfied are you with the work done by your current mp': 'आपके वर्तमान सांसद द्वारा किए गए काम से आप कितने संतुष्ट या असंतुष्ट हैं?',
    'how satisfied or dissatisfied are you with the work done by your current mla': 'आपके वर्तमान विधायक द्वारा किए गए काम से आप कितने संतुष्ट या असंतुष्ट हैं?',
    'who do you think is the best leader': 'आपकी राय में, पश्चिम बंगाल का मुख्यमंत्री बनने के लिए सबसे अच्छा नेता कौन है?',
    'do not read out the options': 'विकल्प न पढ़ें। प्रतिक्रियादाता जो कहता है उसके आधार पर सबसे उपयुक्त विकल्प चुनें।',
    
    // Question texts
    'satisfaction with the cm': 'मुख्यमंत्री के साथ संतुष्टि:',
    'satisfaction with the opposition': 'विरोधी दल के साथ संतुष्टि:',
    'satisfaction with mp': 'सांसद और विधायक के साथ संतुष्टि:',
    'satisfaction with mla': 'सांसद और विधायक के साथ संतुष्टि:',
    'preferred cm candidate': 'पसंदीदा मुख्यमंत्री उम्मीदवार:',
    'in your opinion, what are the three most pressing issues': 'आपकी राय में, पश्चिम बंगाल की तीन सबसे जरूरी समस्याएं क्या हैं?',
    'according to you, which party will win': 'आपके अनुसार, आपके निर्वाचन क्षेत्र में आगामी चुनाव कौन सी पार्टी जीतेगी?',
    'could you please tell me the religion': 'कृपया बताएं कि आप किस धर्म के हैं?',
    'which social category do you belong to': 'आप किस सामाजिक श्रेणी से संबंधित हैं?',
    'could you please tell me your caste': 'कृपया बताएं कि आपकी जाति क्या है?',
    'could you please tell me the highest educational level': 'कृपया बताएं कि परिवार में सबसे अधिक शिक्षित महिला की उच्चतम शैक्षिक स्तर क्या है?',
    'could you please tell me the highest educational level of the most educated male': 'कृपया बताएं कि परिवार में सबसे अधिक शिक्षित पुरुष की उच्चतम शैक्षिक स्तर क्या है?',
    'what is the occupation of the chief wage earner': 'मुख्य वेतन अर्जक का व्यवसाय क्या है?',
    'please share your mobile number': 'कृपया अपना मोबाइल नंबर साझा करें। हम आपको आश्वासन देते हैं कि हम इसे गोपनीय रखेंगे और केवल गुणवत्ता नियंत्रण उद्देश्यों के लिए उपयोग करेंगे।',
    'what is your full name': 'आपका पूरा नाम क्या है? हम आपको आश्वासन देते हैं कि हम इसे गोपनीय रखेंगे',
    'thank you for your excellent responses': 'आपके उत्कृष्ट उत्तरों के लिए धन्यवाद, अब मैं आपसे अपने बारे में कुछ प्रश्न पूछूंगा।',
    
    // Options
    'don\'t know': 'पता नहीं / कह नहीं सकते',
    'can\'t say': 'पता नहीं / कह नहीं सकते',
    'price rise': 'महंगाई / मुद्रास्फीति',
    'inflation': 'महंगाई / मुद्रास्फीति',
    'unemployment': 'बेरोजगारी / नौकरियों की कमी',
    'lack of jobs': 'बेरोजगारी / नौकरियों की कमी',
    'electricity': 'बिजली / बिजली की समस्या',
    'power problems': 'बिजली / बिजली की समस्या',
    'healthcare not good': 'स्वास्थ्य सेवा अच्छी नहीं',
    'education system issues': 'शिक्षा प्रणाली की समस्याएं',
    'voter list issues': 'मतदाता सूची की समस्याएं / नागरिकता खोने का डर',
    'fear of losing citizenship': 'मतदाता सूची की समस्याएं / नागरिकता खोने का डर',
    'safety for migrant workers': 'प्रवासी श्रमिकों की सुरक्षा',
    'teacher protests': 'शिक्षक विरोध और नौकरी की असुरक्षा',
    'job insecurity': 'शिक्षक विरोध और नौकरी की असुरक्षा',
    'floods and natural disasters': 'बाढ़ और प्राकृतिक आपदाएं',
    'communal tensions': 'सांप्रदायिक तनाव / कानून और व्यवस्था की चिंताएं',
    'law-and-order concerns': 'सांप्रदायिक तनाव / कानून और व्यवस्था की चिंताएं',
    'safety of women': 'महिलाओं की सुरक्षा (अपराध / सुरक्षा)',
    'infrastructure': 'अवसंरचना (सड़कें, कनेक्टिविटी)',
    'roads, connectivity': 'अवसंरचना (सड़कें, कनेक्टिविटी)',
    'others (specify)': 'अन्य (निर्दिष्ट करें)',
    'mamata banerjee': 'ममता बनर्जी (तृणमूल)',
    'dilip ghosh': 'दिलीप घोष (भाजपा)',
    'suvendu adhikari': 'शुभेंदु अधिकारी (भाजपा)',
    'sukanta majumudar': 'सुकांत मजुमदार (भाजपा)',
    'abhishek banerjee': 'अभिषेक बनर्जी (तृणमूल)',
    'samik bhattacharya': 'समिक भट्टाचार्य (भाजपा)',
    'subhankar sarkar': 'शुभंकर सरकार (कांग्रेस)',
    'biman bose': 'बिमान बोस (वाम मोर्चा)',
    'srideep': 'श्रीदीप (श्रीदीप) भट्टाचार्य (वाम मोर्चा)',
    'sridip': 'श्रीदीप (श्रीदीप) भट्टाचार्य (वाम मोर्चा)',
    'anyone from tmc': 'तृणमूल से कोई भी',
    'anyone from inc': 'कांग्रेस से कोई भी',
    'anyone from bjp': 'भाजपा से कोई भी',
    'humayun kabir': 'हुमायूं कबीर',
    'aitc (trinamool congress)': 'एआईटीसी (तृणमूल कांग्रेस)',
    'bjp': 'भाजपा',
    'inc': 'कांग्रेस',
    'congress': 'कांग्रेस',
    'left front': 'वाम मोर्चा',
    'no male adult': 'कोई वयस्क पुरुष नहीं',
    'no female adult': 'कोई वयस्क महिला नहीं',
    'no formal education': 'कोई औपचारिक शिक्षा नहीं',
    'upto class 5': 'कक्षा 5 तक',
    'class 6-9': 'कक्षा 6-9',
    'class 10-14': 'कक्षा 10-14',
    'degree(regular)': 'डिग्री (नियमित)',
    'professional degree': 'पेशेवर डिग्री',
    'labour': 'श्रमिक',
    'farmer': 'किसान',
    'worker': 'कर्मचारी',
    'trader': 'व्यापारी',
    'clerical': 'क्लर्क / बिक्री / पर्यवेक्षक',
    'sales': 'क्लर्क / बिक्री / पर्यवेक्षक',
    'supervisor': 'क्लर्क / बिक्री / पर्यवेक्षक',
    'managerial': 'प्रबंधकीय / पेशेवर',
    'professional': 'प्रबंधकीय / पेशेवर',
    'yes, you can': 'हां, आप कर सकते हैं।',
    
    // Religion options
    'hindu': 'हिंदू',
    'muslim': 'मुस्लिम',
    'christian': 'ईसाई',
    'sikh': 'सिख',
    'jain': 'जैन',
    'buddhist': 'बौद्ध',
    'no response': 'कोई उत्तर नहीं',
    
    // Social category options
    'general/oc': 'सामान्य / ओसी',
    'schedule castes': 'अनुसूचित जाति (एससी)',
    'schedule tribes': 'अनुसूचित जनजाति (एसटी)',
    'other backward caste': 'अन्य पिछड़ा वर्ग (ओबीसी)',
    
    // Caste options (common ones)
    'aguri': 'अगुरी',
    'kansabanik': 'कंसाबणिक',
    'sadgop': 'सदगोप',
    'shunri': 'शुनरी',
    'yadav': 'यादव',
    'santal': 'संताल',
    'pod': 'पोड़',
    'tanti': 'तांती',
    'namaseej': 'नमशीज',
    'brahmins': 'ब्राह्मण',
    'kayasthas': 'कायस्थ',
    'baidyas': 'वैद्य',
    'rajputs': 'राजपूत',
    'kshatriyas': 'क्षत्रिय',
    'barui': 'बरुई',
    'gandha banik': 'गंध बणिक',
    'kulin kayasthas': 'कुलीन कायस्थ',
    'mahishya': 'महिष्य',
    'namasudra': 'नमशूद्र',
    'rajbanshi': 'राजबंशी',
    'poundra': 'पौंड्र',
    'dom': 'डोम',
    'bagdi': 'बागड़ी',
    'chamar': 'चमार',
    'much': 'मुच',
    'kori': 'कोरी',
    'haldar': 'हलदार',
    'santhal': 'संथाल',
    'munda': 'मुंडा',
    'oraon': 'ओरांव',
    'bhumij': 'भूमिज',
    'ho': 'हो',
    'lodha': 'लोढ़ा',
    'bhil': 'भील',
    'birhor': 'बिरहोर',
    'mahali': 'महाली',
    'teli/teli sahu': 'तेली/तेली साहू',
    'napit': 'नापित',
    'karmakar': 'कर्मकार',
    'rajak': 'रजक',
    'dhoba': 'धोबा',
    'hela': 'हेला',
    'kahar': 'कहार',
    'keot': 'केओत',
    'kurmi': 'कुरमी',
    'pasi': 'पासी',
    'refused to respond': 'जवाब देने से इनकार'
  };
  
  // Try exact match first
  for (const [pattern, hindi] of Object.entries(translations)) {
    if (lowerEnglish.includes(pattern)) {
      return hindi;
    }
  }
  
  // Try partial matches for specific contexts
  if (questionContext.includes('2021') && lowerEnglish.includes('assembly')) {
    return 'आपने 2021 के पिछले विधानसभा चुनावों (विधायक) में किस पार्टी को वोट दिया था?';
  }
  if (questionContext.includes('2024') && lowerEnglish.includes('lok sabha')) {
    return 'आपने 2024 के पिछले लोकसभा चुनावों (सांसद) में किस पार्टी को वोट दिया था?';
  }
  
  return null;
}

async function addHindiTranslations() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    console.log('='.repeat(80));
    console.log('ADDING HINDI TRANSLATIONS TO SURVEY QUESTIONS');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${SURVEY_ID}\n`);
    
    // Fetch survey
    const survey = await Survey.findById(SURVEY_ID);
    if (!survey) {
      console.log('❌ Survey not found');
      await mongoose.disconnect();
      return;
    }
    
    console.log(`✅ Survey found: ${survey.surveyName}\n`);
    
    // Create backup/revert report
    const revertReport = {
      surveyId: SURVEY_ID,
      surveyName: survey.surveyName,
      timestamp: new Date().toISOString(),
      changes: []
    };
    
    let totalChanges = 0;
    let skippedChanges = 0;
    
    // Process each section
    survey.sections.forEach((section, sectionIndex) => {
      if (!section.questions || !Array.isArray(section.questions)) {
        return;
      }
      
      section.questions.forEach((question, questionIndex) => {
        const questionNumber = question.questionNumber || question.order || `Q${questionIndex + 1}`;
        const questionId = question.id || `section${sectionIndex}_q${questionIndex}`;
        
        // Check and update question text
        if (question.text && missingHindiTranslation(question.text)) {
          const english = getEnglishText(question.text);
          const bengali = getBengaliText(question.text);
          const hindi = getHindiTranslation(english, bengali, questionNumber);
          
          if (hindi) {
            const oldText = question.text;
            question.text = addHindiTranslation(question.text, hindi);
            
            revertReport.changes.push({
              sectionIndex: sectionIndex + 1,
              sectionTitle: section.sectionTitle || `Section ${sectionIndex + 1}`,
              questionNumber: questionNumber,
              questionId: questionId,
              fieldType: 'question_text',
              fieldPath: 'text',
              oldValue: oldText,
              newValue: question.text,
              hindiAdded: hindi
            });
            
            totalChanges++;
            console.log(`✅ Added Hindi to Q${questionNumber} - Question Text`);
          } else {
            skippedChanges++;
            console.log(`⚠️  Could not auto-translate Q${questionNumber} - Question Text: "${english.substring(0, 50)}..."`);
          }
        }
        
        // Check and update description
        if (question.description && missingHindiTranslation(question.description)) {
          const english = getEnglishText(question.description);
          const bengali = getBengaliText(question.description);
          const hindi = getHindiTranslation(english, bengali, questionNumber + ' description');
          
          if (hindi) {
            const oldDescription = question.description;
            question.description = addHindiTranslation(question.description, hindi);
            
            revertReport.changes.push({
              sectionIndex: sectionIndex + 1,
              sectionTitle: section.sectionTitle || `Section ${sectionIndex + 1}`,
              questionNumber: questionNumber,
              questionId: questionId,
              fieldType: 'description',
              fieldPath: 'description',
              oldValue: oldDescription,
              newValue: question.description,
              hindiAdded: hindi
            });
            
            totalChanges++;
            console.log(`✅ Added Hindi to Q${questionNumber} - Description`);
          } else {
            skippedChanges++;
            console.log(`⚠️  Could not auto-translate Q${questionNumber} - Description: "${english.substring(0, 50)}..."`);
          }
        }
        
        // Check and update options
        if (question.options && Array.isArray(question.options)) {
          question.options.forEach((option, optIndex) => {
            if (option.text && missingHindiTranslation(option.text)) {
              const english = getEnglishText(option.text);
              const bengali = getBengaliText(option.text);
              const hindi = getHindiTranslation(english, bengali, questionNumber + ' option');
              
              if (hindi) {
                const oldText = option.text;
                option.text = addHindiTranslation(option.text, hindi);
                
                revertReport.changes.push({
                  sectionIndex: sectionIndex + 1,
                  sectionTitle: section.sectionTitle || `Section ${sectionIndex + 1}`,
                  questionNumber: questionNumber,
                  questionId: questionId,
                  fieldType: 'option',
                  fieldPath: `options[${optIndex}].text`,
                  oldValue: oldText,
                  newValue: option.text,
                  hindiAdded: hindi
                });
                
                totalChanges++;
                console.log(`✅ Added Hindi to Q${questionNumber} - Option ${optIndex + 1}`);
              } else {
                skippedChanges++;
                console.log(`⚠️  Could not auto-translate Q${questionNumber} - Option ${optIndex + 1}: "${english.substring(0, 40)}..."`);
              }
            }
          });
        }
      });
    });
    
    // Save survey if changes were made
    if (totalChanges > 0) {
      await survey.save();
      console.log(`\n✅ Survey updated with ${totalChanges} Hindi translations`);
      console.log(`⚠️  Skipped ${skippedChanges} items (needs manual translation)\n`);
    } else {
      console.log('\n⚠️  No changes made (no Hindi translations could be auto-added)\n');
    }
    
    // Save revert report
    const reportsDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const revertReportPath = path.join(reportsDir, `hindi_translations_revert_${timestamp}.json`);
    fs.writeFileSync(revertReportPath, JSON.stringify(revertReport, null, 2), 'utf8');
    
    console.log('='.repeat(80));
    console.log('REVERT REPORT');
    console.log('='.repeat(80));
    console.log(`Total changes: ${totalChanges}`);
    console.log(`Skipped items: ${skippedChanges}`);
    console.log(`Revert report saved to: ${revertReportPath}\n`);
    console.log('To revert these changes, run:');
    console.log(`  node scripts/revert_hindi_translations.js ${revertReportPath}\n`);
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

addHindiTranslations();
