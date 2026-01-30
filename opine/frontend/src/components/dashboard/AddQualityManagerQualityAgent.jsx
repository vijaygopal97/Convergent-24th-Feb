import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Check, 
  AlertCircle, 
  Loader,
  User,
  Phone,
  Lock,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Eye
} from 'lucide-react';
import { authAPI, surveyAPI } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

const AddQualityManagerQualityAgent = ({ onQualityAgentCreated }) => {
  const { showSuccess, showError } = useToast();
  const { user: currentUser } = useAuth();
  const [formData, setFormData] = useState({
    qualityAgentId: '', // Optional - can be left empty for auto-generation
    firstName: '',
    lastName: '',
    phone: '',
    password: '',
    usePhoneAsPassword: false,
    surveyIds: [] // Multi-select surveys
  });

  const [formStatus, setFormStatus] = useState({
    loading: false,
    success: false,
    error: null
  });

  const [showPassword, setShowPassword] = useState(false);
  const [memberIdChecking, setMemberIdChecking] = useState(false);
  const [memberIdAvailable, setMemberIdAvailable] = useState(null); // null = not checked, true = available, false = taken
  const [memberIdCheckMessage, setMemberIdCheckMessage] = useState('');
  const memberIdCheckTimeoutRef = useRef(null);

  const [availableSurveys, setAvailableSurveys] = useState([]);
  const [loadingSurveys, setLoadingSurveys] = useState(true);
  const [surveySearchTerm, setSurveySearchTerm] = useState('');
  const [showSurveyDropdown, setShowSurveyDropdown] = useState(false);
  const surveyDropdownRef = useRef(null);

  // Load active surveys
  useEffect(() => {
    const loadSurveys = async () => {
      try {
        setLoadingSurveys(true);
        const response = await surveyAPI.getSurveys({
          page: 1,
          limit: 1000,
          status: 'active'
        });

        if (response.success) {
          setAvailableSurveys(response.data.surveys || []);
        }
      } catch (error) {
        console.error('Error loading surveys:', error);
        showError('Failed to load surveys');
      } finally {
        setLoadingSurveys(false);
      }
    };

    loadSurveys();
  }, []);

  // Close survey dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (surveyDropdownRef.current && !surveyDropdownRef.current.contains(event.target)) {
        setShowSurveyDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Check member ID availability in real-time
  useEffect(() => {
    // Clear previous timeout
    if (memberIdCheckTimeoutRef.current) {
      clearTimeout(memberIdCheckTimeoutRef.current);
    }

    // Reset state if quality agent ID is empty
    if (!formData.qualityAgentId || formData.qualityAgentId.trim() === '') {
      setMemberIdAvailable(null);
      setMemberIdCheckMessage('');
      return;
    }

    // Debounce the check (wait 500ms after user stops typing)
    memberIdCheckTimeoutRef.current = setTimeout(async () => {
      const memberId = formData.qualityAgentId.trim();
      
      // Validate format (must be numeric, up to 6 digits)
      if (!/^\d+$/.test(memberId)) {
        setMemberIdAvailable(false);
        setMemberIdCheckMessage('Quality Agent ID must be numeric');
        return;
      }
      
      if (memberId.length > 6) {
        setMemberIdAvailable(false);
        setMemberIdCheckMessage('Quality Agent ID can only have up to 6 digits');
        return;
      }

      setMemberIdChecking(true);
      try {
        const response = await authAPI.checkMemberIdAvailability(memberId);
        if (response.success) {
          setMemberIdAvailable(response.data.available);
          setMemberIdCheckMessage(
            response.data.available 
              ? 'Quality Agent ID is available' 
              : 'Quality Agent ID is already taken'
          );
        } else {
          setMemberIdAvailable(false);
          setMemberIdCheckMessage('Error checking availability');
        }
      } catch (error) {
        console.error('Error checking member ID:', error);
        setMemberIdAvailable(false);
        setMemberIdCheckMessage('Error checking availability');
      } finally {
        setMemberIdChecking(false);
      }
    }, 500);

    return () => {
      if (memberIdCheckTimeoutRef.current) {
        clearTimeout(memberIdCheckTimeoutRef.current);
      }
    };
  }, [formData.qualityAgentId]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));

    // Auto-update password if usePhoneAsPassword is checked
    if (name === 'usePhoneAsPassword' && checked) {
      setFormData(prev => ({
        ...prev,
        password: prev.phone
      }));
    }

    // Auto-update password when phone changes and usePhoneAsPassword is checked
    if (name === 'phone' && formData.usePhoneAsPassword) {
      setFormData(prev => ({
        ...prev,
        password: value
      }));
    }
  };

  const handleSurveyToggle = (surveyId) => {
    setFormData(prev => {
      const currentIds = prev.surveyIds || [];
      if (currentIds.includes(surveyId)) {
        return {
          ...prev,
          surveyIds: currentIds.filter(id => id !== surveyId)
        };
      } else {
        return {
          ...prev,
          surveyIds: [...currentIds, surveyId]
        };
      }
    });
  };

  const filteredSurveys = availableSurveys.filter(survey =>
    survey.surveyName?.toLowerCase().includes(surveySearchTerm.toLowerCase()) ||
    survey.description?.toLowerCase().includes(surveySearchTerm.toLowerCase())
  );

  const validateForm = () => {
    const errors = [];

    if (!formData.firstName.trim()) {
      errors.push('First name is required');
    }

    if (!formData.lastName.trim()) {
      errors.push('Last name is required');
    }

    if (!formData.phone.trim()) {
      errors.push('Phone number is required');
    } else {
      const phoneRegex = /^[\+]?[0-9][\d]{0,15}$/;
      if (!phoneRegex.test(formData.phone.replace(/\s+/g, ''))) {
        errors.push('Please enter a valid phone number');
      }
    }

    if (!formData.usePhoneAsPassword && !formData.password) {
      errors.push('Password is required');
    } else if (!formData.usePhoneAsPassword && formData.password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }

    // Validate quality agent ID if provided
    if (formData.qualityAgentId && formData.qualityAgentId.trim() !== '') {
      if (memberIdAvailable === false) {
        errors.push('Quality Agent ID is not available');
      }
      if (memberIdAvailable === null && memberIdChecking) {
        errors.push('Please wait while we check Quality Agent ID availability');
      }
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      validationErrors.forEach(error => {
        showError('Validation Error', error);
      });
      return;
    }

    setFormStatus({ loading: true, success: false, error: null });

    try {
      // Normalize phone number
      let normalizedPhone = formData.phone.replace(/^\+91/, '').replace(/^91/, '').trim();

      // Format quality agent ID if provided
      let formattedQualityAgentId = formData.qualityAgentId.trim();
      if (formattedQualityAgentId && !/^\d+$/.test(formattedQualityAgentId)) {
        // Remove non-numeric characters
        formattedQualityAgentId = formattedQualityAgentId.replace(/\D/g, '');
      }

      const qualityAgentData = {
        qualityAgentId: formattedQualityAgentId || undefined, // Send undefined if empty for auto-generation
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        phone: normalizedPhone,
        password: formData.usePhoneAsPassword ? undefined : formData.password,
        usePhoneAsPassword: formData.usePhoneAsPassword,
        surveyIds: formData.surveyIds || []
      };

      const response = await authAPI.addQualityAgentByQualityManager(qualityAgentData);

      if (response.success) {
        setFormStatus({ loading: false, success: true, error: null });
        showSuccess('Quality Agent Added!', 'Quality agent has been added to your team successfully.');
        
        // Reset form
        setFormData({
          qualityAgentId: '',
          firstName: '',
          lastName: '',
          phone: '',
          password: '',
          usePhoneAsPassword: false,
          surveyIds: []
        });
        setMemberIdAvailable(null);
        setMemberIdCheckMessage('');

        // Call callback
        if (onQualityAgentCreated) {
          onQualityAgentCreated();
        }
      } else {
        const errorMessage = response.message || 'Quality agent creation failed';
        setFormStatus({
          loading: false,
          success: false,
          error: errorMessage
        });
        showError('Quality Agent Creation Failed', errorMessage);
      }
    } catch (error) {
      console.error('Add quality agent error:', error);
      let errorMessage = 'Quality agent creation failed. Please try again.';

      if (error.response?.data) {
        if (error.response.data.message) {
          errorMessage = error.response.data.message;
        } else if (error.response.data.errors) {
          if (Array.isArray(error.response.data.errors)) {
            errorMessage = error.response.data.errors.map(err => err.message || err).join(', ');
          } else {
            errorMessage = JSON.stringify(error.response.data.errors);
          }
        }
      } else if (error.message) {
        errorMessage = error.message;
      }

      setFormStatus({
        loading: false,
        success: false,
        error: errorMessage
      });
      showError('Quality Agent Creation Failed', errorMessage);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Add Quality Agent</h1>
        <p className="text-gray-600">Add a new quality agent to your team</p>
      </div>

      <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-100">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Quality Agent ID */}
          <div>
            <label htmlFor="qualityAgentId" className="block text-sm font-medium text-gray-700 mb-2">
              Quality Agent ID (Optional)
              <span className="text-gray-500 text-xs ml-2">
                Format: Up to 6 digits (e.g., 123456). Leave empty for auto-generation.
              </span>
            </label>
            <div className="relative">
              <input
                type="text"
                id="qualityAgentId"
                name="qualityAgentId"
                value={formData.qualityAgentId}
                onChange={handleChange}
                placeholder="123456"
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  memberIdAvailable === false ? 'border-red-300' : 
                  memberIdAvailable === true ? 'border-green-300' : 
                  'border-gray-300'
                }`}
                maxLength={6}
              />
              {formData.qualityAgentId && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  {memberIdChecking ? (
                    <Loader className="w-5 h-5 animate-spin text-gray-400" />
                  ) : memberIdAvailable === true ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : memberIdAvailable === false ? (
                    <XCircle className="w-5 h-5 text-red-500" />
                  ) : null}
                </div>
              )}
            </div>
            {memberIdCheckMessage && (
              <p className={`mt-1 text-xs ${
                memberIdAvailable === true ? 'text-green-600' : 
                memberIdAvailable === false ? 'text-red-600' : 
                'text-gray-500'
              }`}>
                {memberIdCheckMessage}
              </p>
            )}
          </div>

          {/* Name Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-2">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="firstName"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-2">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="lastName"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Phone Number */}
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
              Phone Number <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                required
                placeholder="10-digit phone number"
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="flex items-center mb-2">
              <input
                type="checkbox"
                name="usePhoneAsPassword"
                checked={formData.usePhoneAsPassword}
                onChange={handleChange}
                className="mr-2 rounded border-gray-300 text-[#001D48] focus:ring-[#001D48]"
              />
              <span className="text-sm font-medium text-gray-700">
                Use phone number as password
              </span>
            </label>
            {!formData.usePhoneAsPassword && (
              <div className="mt-2">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  Password <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    minLength={8}
                    className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <Eye className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">Password must be at least 8 characters long</p>
              </div>
            )}
          </div>

          {/* Survey Assignment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Assign to Surveys (Optional)
            </label>
            <div className="relative" ref={surveyDropdownRef}>
              <div
                onClick={() => setShowSurveyDropdown(!showSurveyDropdown)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg cursor-pointer bg-white flex items-center justify-between"
              >
                <span className="text-gray-700">
                  {formData.surveyIds.length > 0
                    ? `${formData.surveyIds.length} survey(s) selected`
                    : 'Select surveys (optional)'}
                </span>
                <span className="text-gray-400">{showSurveyDropdown ? '▲' : '▼'}</span>
              </div>
              {showSurveyDropdown && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                  {loadingSurveys ? (
                    <div className="p-4 text-center text-gray-500">
                      <Loader className="w-5 h-5 animate-spin mx-auto mb-2" />
                      Loading surveys...
                    </div>
                  ) : (
                    <>
                      <div className="p-2 border-b border-gray-200">
                        <input
                          type="text"
                          placeholder="Search surveys..."
                          value={surveySearchTerm}
                          onChange={(e) => setSurveySearchTerm(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {filteredSurveys.length === 0 ? (
                          <div className="p-4 text-center text-gray-500 text-sm">
                            No surveys found
                          </div>
                        ) : (
                          filteredSurveys.map((survey) => (
                            <label
                              key={survey._id || survey.id}
                              className="flex items-center px-4 py-2 hover:bg-gray-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={formData.surveyIds.includes(survey._id || survey.id)}
                                onChange={() => handleSurveyToggle(survey._id || survey.id)}
                                className="mr-3 rounded border-gray-300 text-[#001D48] focus:ring-[#001D48]"
                              />
                              <div className="flex-1">
                                <div className="text-sm font-medium text-gray-900">
                                  {survey.surveyName || survey.title || 'Untitled Survey'}
                                </div>
                                {survey.description && (
                                  <div className="text-xs text-gray-500 truncate">
                                    {survey.description}
                                  </div>
                                )}
                              </div>
                            </label>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            {formData.surveyIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {formData.surveyIds.map((surveyId) => {
                  const survey = availableSurveys.find(s => (s._id || s.id) === surveyId);
                  return survey ? (
                    <span
                      key={surveyId}
                      className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs"
                    >
                      {survey.surveyName || survey.title}
                      <button
                        type="button"
                        onClick={() => handleSurveyToggle(surveyId)}
                        className="ml-2 text-blue-700 hover:text-blue-900"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ) : null;
                })}
              </div>
            )}
          </div>

          {/* Error Message */}
          {formStatus.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800">Error</p>
                <p className="text-sm text-red-700 mt-1">{formStatus.error}</p>
              </div>
            </div>
          )}

          {/* Success Message */}
          {formStatus.success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start space-x-3">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-green-800">Success!</p>
                <p className="text-sm text-green-700 mt-1">Quality agent has been added successfully.</p>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex items-center justify-end space-x-4 pt-4 border-t border-gray-200">
            <button
              type="submit"
              disabled={formStatus.loading}
              className="flex items-center px-6 py-2.5 bg-[#001D48] text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {formStatus.loading ? (
                <>
                  <Loader className="w-5 h-5 mr-2 animate-spin" />
                  Adding Quality Agent...
                </>
              ) : (
                <>
                  <User className="w-5 h-5 mr-2" />
                  Add Quality Agent
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddQualityManagerQualityAgent;

