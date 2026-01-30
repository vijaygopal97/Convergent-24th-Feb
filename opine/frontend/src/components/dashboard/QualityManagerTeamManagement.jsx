import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Filter, 
  Plus, 
  Edit, 
  ChevronLeft, 
  ChevronRight,
  Users,
  UserCheck,
  UserX,
  Loader,
  X,
  AlertCircle,
  Calendar
} from 'lucide-react';
import { authAPI } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import AddQualityManagerQualityAgent from './AddQualityManagerQualityAgent';

const QualityManagerTeamManagement = () => {
  const { showSuccess, showError } = useToast();
  const { user: currentUser } = useAuth();
  const [qualityAgents, setQualityAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({});
  
  // Search and filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [pageSize, setPageSize] = useState(15);
  const [currentPage, setCurrentPage] = useState(1);
  
  // UI states
  const [showAddQualityAgent, setShowAddQualityAgent] = useState(false);
  const [showEditQualityAgent, setShowEditQualityAgent] = useState(false);
  const [selectedQualityAgent, setSelectedQualityAgent] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  // Load assigned quality agents for the quality manager
  const loadQualityAgents = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch current user with populated assignedTeamMembers
      const userResponse = await authAPI.getMe();
      
      if (!userResponse.success || !userResponse.data?.assignedTeamMembers) {
        setQualityAgents([]);
        setPagination({ totalUsers: 0, current: 1, pages: 1 });
        return;
      }

      const assignedTeamMembers = userResponse.data.assignedTeamMembers;
      
      // Extract quality agent data directly from assignedTeamMembers
      let agents = assignedTeamMembers
        .filter(member => member.userType === 'quality_agent' && member.user)
        .map(member => {
          const user = member.user;
          return {
            _id: user._id || user,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            email: user.email || '',
            phone: user.phone || '',
            memberId: user.memberId || '',
            userType: user.userType || 'quality_agent',
            status: user.status || 'active',
            createdAt: user.createdAt || new Date()
          };
        });

      if (agents.length === 0) {
        setQualityAgents([]);
        setPagination({ totalUsers: 0, current: 1, pages: 1 });
        return;
      }

      // Apply search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        agents = agents.filter(user => 
          (user.firstName && user.firstName.toLowerCase().includes(searchLower)) ||
          (user.lastName && user.lastName.toLowerCase().includes(searchLower)) ||
          (user.email && user.email.toLowerCase().includes(searchLower)) ||
          (user.phone && user.phone.includes(searchTerm)) ||
          (user.memberId && user.memberId.toLowerCase().includes(searchLower))
        );
      }

      // Apply status filter
      if (selectedStatus) {
        agents = agents.filter(user => user.status === selectedStatus);
      }

      // Apply pagination
      const totalUsers = agents.length;
      const startIndex = (currentPage - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedUsers = agents.slice(startIndex, endIndex);
      
      setQualityAgents(paginatedUsers);
      setPagination({
        current: currentPage,
        pages: Math.ceil(totalUsers / pageSize),
        totalUsers: totalUsers,
        hasNext: endIndex < totalUsers,
        hasPrev: currentPage > 1
      });
    } catch (error) {
      console.error('Error loading quality agents:', error);
      setError('Failed to load quality agents');
      setQualityAgents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQualityAgents();
  }, [currentPage, pageSize, searchTerm, selectedStatus]);

  // Handle search
  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  // Handle filters
  const handleFilterChange = (filterType, value) => {
    switch (filterType) {
      case 'status':
        setSelectedStatus(value);
        break;
      default:
        break;
    }
    setCurrentPage(1);
  };

  // Clear all filters
  const clearFilters = () => {
    setSearchTerm('');
    setSelectedStatus('');
    setCurrentPage(1);
  };

  // Handle pagination
  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
  };

  const handlePageSizeChange = (newSize) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  // Handle quality agent actions
  const handleEditQualityAgent = (agent) => {
    setSelectedQualityAgent(agent);
    setShowEditQualityAgent(true);
  };

  const handleUpdateQualityAgent = async () => {
    // TODO: Implement edit functionality
    await loadQualityAgents();
  };

  // Get status badge
  const getStatusBadge = (status) => {
    const statusConfig = {
      active: { color: 'bg-green-100 text-green-800', icon: <UserCheck className="w-3 h-3" /> },
      pending: { color: 'bg-yellow-100 text-yellow-800', icon: <AlertCircle className="w-3 h-3" /> },
      inactive: { color: 'bg-gray-100 text-gray-800', icon: <UserX className="w-3 h-3" /> },
      suspended: { color: 'bg-red-100 text-red-800', icon: <X className="w-3 h-3" /> }
    };
    
    const config = statusConfig[status] || statusConfig.inactive;
    
    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
        {config.icon}
        <span className="ml-1 capitalize">{status}</span>
      </span>
    );
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (showAddQualityAgent) {
    return (
      <div>
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() => setShowAddQualityAgent(false)}
            className="flex items-center text-gray-600 hover:text-gray-800"
          >
            <ChevronLeft className="w-5 h-5 mr-2" />
            Back to Team Management
          </button>
        </div>
        <AddQualityManagerQualityAgent 
          onQualityAgentCreated={() => {
            setShowAddQualityAgent(false);
            loadQualityAgents();
          }} 
        />
      </div>
    );
  }

  if (showEditQualityAgent && selectedQualityAgent) {
    return (
      <div>
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() => {
              setShowEditQualityAgent(false);
              setSelectedQualityAgent(null);
            }}
            className="flex items-center text-gray-600 hover:text-gray-800"
          >
            <ChevronLeft className="w-5 h-5 mr-2" />
            Back to Team Management
          </button>
        </div>
        {/* TODO: Add EditQualityManagerQualityAgent component */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <p className="text-gray-600">Edit Quality Agent functionality will be implemented here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Team Management</h1>
          <p className="text-gray-600 mt-1">Manage your assigned quality agents</p>
        </div>
        <button
          onClick={() => setShowAddQualityAgent(true)}
          className="flex items-center px-4 py-2 bg-[#001D48] text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Quality Agent
        </button>
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search by name, email, phone, or Quality Agent ID..."
                value={searchTerm}
                onChange={handleSearch}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Filter Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </button>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Status Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                <select
                  value={selectedStatus}
                  onChange={(e) => handleFilterChange('status', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>

            {/* Clear Filters */}
            <div className="mt-4 flex justify-end">
              <button
                onClick={clearFilters}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Clear All Filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Results Summary */}
      <div className="flex items-center justify-between text-sm text-gray-600">
        <div>
          Showing {qualityAgents.length} of {pagination.totalUsers || qualityAgents.length} quality agents
        </div>
        <div className="flex items-center space-x-2">
          <span>Per page:</span>
          <select
            value={pageSize}
            onChange={(e) => handlePageSizeChange(parseInt(e.target.value))}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value={15}>15</option>
            <option value={30}>30</option>
            <option value={45}>45</option>
          </select>
        </div>
      </div>

      {/* Quality Agents Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="w-6 h-6 animate-spin text-[#373177]" />
            <span className="ml-2 text-gray-600">Loading quality agents...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-12 text-red-600">
            <AlertCircle className="w-6 h-6 mr-2" />
            {error}
          </div>
        ) : qualityAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Users className="w-12 h-12 mb-4 text-gray-400" />
            <p className="text-lg font-medium mb-2">No quality agents found</p>
            <p className="text-sm">Add your first quality agent to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quality Agent
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Joined
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {qualityAgents.map((agent) => (
                  <tr key={agent._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-10 h-10 bg-gradient-to-r from-[#373177] to-[#373177] rounded-full flex items-center justify-center text-white font-medium">
                          {agent.firstName?.charAt(0) || 'Q'}{agent.lastName?.charAt(0) || 'A'}
                        </div>
                        <div className="ml-4">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              {agent.firstName} {agent.lastName}
                            </span>
                            {agent.memberId && (
                              <span className="text-xs bg-[#E6F0F8] text-blue-700 px-2 py-0.5 rounded font-mono">
                                ID: {agent.memberId}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500">{agent.email}</div>
                          {agent.phone && (
                            <div className="text-xs text-gray-400">{agent.phone}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(agent.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(agent.createdAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => handleEditQualityAgent(agent)}
                          className="text-[#373177] hover:text-[#001D48] transition-colors"
                          title="Edit Quality Agent"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between bg-white px-6 py-4 border-t border-gray-200 rounded-b-lg">
          <div className="text-sm text-gray-600">
            Page {pagination.current || currentPage} of {pagination.pages || 1}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handlePageChange((pagination.current || currentPage) - 1)}
              disabled={(pagination.current || currentPage) === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => handlePageChange((pagination.current || currentPage) + 1)}
              disabled={(pagination.current || currentPage) >= (pagination.pages || 1)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default QualityManagerTeamManagement;

