/**
 * Response Normalizer Utility
 * Backend-only solution to normalize questionText in responses for reliable mobile app matching
 * This ensures name questions are always identifiable without changing mobile app code
 */

/**
 * Normalize responses array to ensure name questions are reliably identifiable
 * This fixes the issue where mobile app's text matching fails and falls back to gender
 * 
 * Strategy: Ensure name questions always start with "What is your full name" 
 * even if they have additional text, so the mobile app's search for "what is your full name" always matches
 */
function normalizeResponsesForMobileApp(responses) {
  if (!responses || !Array.isArray(responses)) {
    return responses;
  }

  // FIRST PASS: Identify name questions and normalize them
  // SECOND PASS: Ensure no other questions contain the exact phrase "what is your full name"
  
  return responses.map(response => {
    if (!response || !response.questionText) {
      return response;
    }

    const questionText = response.questionText;
    const questionTextLower = questionText.toLowerCase();

    // CRITICAL: Exclude gender questions first to prevent false positives
    const isGenderQuestion = 
      questionTextLower.includes('gender') ||
      questionTextLower.includes('respondent\'s gender') ||
      questionTextLower.includes('respondents gender') ||
      questionTextLower.includes('sex') ||
      (questionTextLower.includes('note') && questionTextLower.includes('gender'));
    
    // Extract main text (without translations) for accurate matching
    const translationMatch = questionText.match(/^(.+?)\s*\{([^}]+)\}\s*$/);
    const mainText = translationMatch ? translationMatch[1].trim() : questionText.trim();
    const mainTextLower = mainText.toLowerCase();
    
    // Only check for name patterns if it's NOT a gender question
    const isNameQuestion = !isGenderQuestion && (
      // Exact match patterns (most reliable)
      mainTextLower.includes('what is your full name') ||
      mainTextLower.includes('what is your name') ||
      mainTextLower.includes('would you like to share your name') ||
      mainTextLower.includes('share your name') ||
      mainTextLower.includes('name with us') ||
      // Question number patterns (Q28, 28, etc.)
      (response.questionNumber && (response.questionNumber === '28' || response.questionNumber === 'Q28' || String(response.questionNumber).includes('28'))) ||
      // Question ID patterns (for specific survey)
      (response.questionId && response.questionId.includes('respondent_name')) ||
      // Pattern: contains "name" AND ("what is your" OR "share") - but NOT gender
      ((mainTextLower.includes('name') && 
        (mainTextLower.includes('what is your') || mainTextLower.includes('share'))) &&
       !isGenderQuestion)
    );

    if (isNameQuestion) {
      // CRITICAL: Normalize name question text to ALWAYS start with "What is your full name"
      // This ensures mobile app's search for "what is your full name" matches on FIRST comparison
      // The app searches: ['what is your full name', 'full name', 'name']
      // By ensuring "what is your full name" is at the start, we guarantee first-match success
      
      let normalizedMainText = mainText;
      let translation = translationMatch ? translationMatch[2].trim() : null;
      
      // CRITICAL: Ensure mainText ALWAYS starts with "What is your full name"
      // This is the PRIMARY text the app searches for, so it must be present
      const targetText = 'what is your full name';
      
      if (!mainTextLower.includes(targetText)) {
        // If "what is your full name" is not present, we need to add it
        // Check if it has variations we can replace
        if (mainTextLower.includes('what is your name')) {
          // Replace "what is your name" with "what is your full name"
          normalizedMainText = mainText.replace(/what\s+is\s+your\s+name/gi, 'What is your full name');
        } else if (mainTextLower.includes('share your name') || mainTextLower.includes('name with us')) {
          // For "Would you like to share your name" type questions, prepend the target text
          normalizedMainText = 'What is your full name? ' + mainText;
        } else {
          // For any other name question, prepend the target text
          normalizedMainText = 'What is your full name? ' + mainText;
        }
      } else {
        // "what is your full name" exists, but ensure it's at the START
        // Extract everything before "what is your full name" and move it after
        const beforeMatch = mainTextLower.indexOf(targetText);
        if (beforeMatch > 0) {
          const beforeText = mainText.substring(0, beforeMatch).trim();
          const afterText = mainText.substring(beforeMatch).trim();
          // Capitalize the first letter of "what is your full name"
          const normalizedTarget = 'What is your full name' + afterText.substring(targetText.length);
          normalizedMainText = normalizedTarget + (beforeText ? ' ' + beforeText : '');
        } else {
          // It's already at the start or close to it, just ensure proper capitalization
          normalizedMainText = mainText.replace(/what\s+is\s+your\s+full\s+name/gi, 'What is your full name');
        }
      }
      
      // CRITICAL: Ensure it starts with the exact target text (case-insensitive check)
      // This is the PRIMARY search term, so it MUST be at the start
      if (!normalizedMainText.toLowerCase().startsWith(targetText)) {
        // If somehow it still doesn't start with it, force prepend
        normalizedMainText = 'What is your full name? ' + normalizedMainText;
      }
      
      // Reconstruct with translation if it existed
      const normalizedText = translation 
        ? `${normalizedMainText} {${translation}}`
        : normalizedMainText;
      
      return {
        ...response,
        questionText: normalizedText
      };
    }
    
    // CRITICAL: For NON-name questions, ensure they DON'T start with "What is your full name"
    // This prevents false matches when the mobile app searches for name questions
    // If a non-name question somehow contains "what is your full name", remove or modify it
    if (!isGenderQuestion && mainTextLower.includes('what is your full name')) {
      // This shouldn't happen, but if it does, we need to modify it
      // Replace "what is your full name" with something that won't match
      const modifiedMainText = mainText.replace(/what\s+is\s+your\s+full\s+name/gi, '');
      const translation = translationMatch ? translationMatch[2].trim() : null;
      const modifiedText = translation 
        ? `${modifiedMainText.trim()} {${translation}}`
        : modifiedMainText.trim();
      
      return {
        ...response,
        questionText: modifiedText
      };
    }

    // Return response as-is if not a name question and doesn't contain the target phrase
    return response;
  });
}

/**
 * Normalize a single survey response object (used in getSurveyResponseById, getNextReviewAssignment, etc.)
 */
function normalizeSurveyResponseForMobileApp(surveyResponse) {
  if (!surveyResponse) {
    return surveyResponse;
  }

  // Convert to plain object if needed
  const responseData = surveyResponse.toObject ? surveyResponse.toObject() : surveyResponse;

  // Normalize responses array
  if (responseData.responses && Array.isArray(responseData.responses)) {
    responseData.responses = normalizeResponsesForMobileApp(responseData.responses);
    
    // CRITICAL: Reorder responses so name question comes FIRST
    // This ensures mobile app's find() method finds the name question before any other question
    // that might contain "name" in its text
    const nameQuestionIndex = responseData.responses.findIndex(r => {
      if (!r || !r.questionText) return false;
      const translationMatch = r.questionText.match(/^(.+?)\s*\{([^}]+)\}\s*$/);
      const mainText = translationMatch ? translationMatch[1].trim() : r.questionText.trim();
      return mainText.toLowerCase().startsWith('what is your full name');
    });
    
    if (nameQuestionIndex > 0) {
      // Move name question to the beginning
      const nameQuestion = responseData.responses[nameQuestionIndex];
      responseData.responses.splice(nameQuestionIndex, 1);
      responseData.responses.unshift(nameQuestion);
    }
  }

  return responseData;
}

module.exports = {
  normalizeResponsesForMobileApp,
  normalizeSurveyResponseForMobileApp
};

