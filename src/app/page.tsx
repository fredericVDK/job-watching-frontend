'use client';

import { useState, useEffect } from 'react';
import { Job, Stats } from '@/types';
import { JobCard } from '@/components/JobCard';
import { SearchBar } from '@/components/SearchBar';
import { Briefcase, Building2, Clock, Loader2 } from 'lucide-react';

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchJobs();
    fetchStats();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      fetchJobs(`/api/jobs?search=${encodeURIComponent(searchQuery)}`);
    } else {
      fetchJobs();
    }
  }, [searchQuery]);

  const fetchJobs = async (url = '/api/jobs') => {
    try {
      setLoading(true);
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setFilteredJobs(data);
        if (!searchQuery) {
          setJobs(data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/stats');
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
  };

  if (loading && jobs.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span className="text-gray-600">Loading jobs...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Job Watcher
          </h1>
          <p className="text-gray-600">
            Discover job opportunities from top tech companies
          </p>
        </header>

        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center">
                <Briefcase className="w-8 h-8 text-blue-600 mr-3" />
                <div>
                  <p className="text-sm text-gray-600">Total Jobs</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalJobs}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center">
                <Building2 className="w-8 h-8 text-green-600 mr-3" />
                <div>
                  <p className="text-sm text-gray-600">Companies</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.companies}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center">
                <Clock className="w-8 h-8 text-purple-600 mr-3" />
                <div>
                  <p className="text-sm text-gray-600">Latest Update</p>
                  <p className="text-lg font-bold text-gray-900">
                    {stats.latestJob ? new Date(stats.latestJob).toLocaleDateString() : 'N/A'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mb-8">
          <SearchBar onSearch={handleSearch} />
        </div>

        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {searchQuery ? `Search Results (${filteredJobs.length})` : `All Jobs (${filteredJobs.length})`}
          </h2>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">
              {searchQuery ? 'No jobs found matching your search.' : 'No jobs available.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredJobs.map((job) => (
              <JobCard key={job.url} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
