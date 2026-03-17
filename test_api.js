// Test API endpoint
fetch('/api/jobs')
  .then(response => response.json())
  .then(jobs => {
    console.log('Jobs from API:', jobs);
    console.log('Number of jobs:', jobs.length);
    jobs.forEach((job, i) => {
      console.log(`Job ${i+1}:`, job);
    });
  })
  .catch(error => console.error('API Error:', error));
