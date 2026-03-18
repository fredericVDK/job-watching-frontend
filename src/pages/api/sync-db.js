// API route to sync database from S3
import AWS from 'aws-sdk';

// Configure AWS SDK
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'eu-west-1'
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Syncing database from S3...');

    // Get database from S3
    const s3Object = await s3.getObject({
      Bucket: process.env.S3_BUCKET || 'job-watcher-data',
      Key: process.env.S3_KEY || 'jobs.db'
    }).promise();

    // Save to local filesystem
    const fs = require('fs');
    const path = require('path');
    
    const dbPath = path.join(process.cwd(), 'jobs.db');
    fs.writeFileSync(dbPath, s3Object.Body);

    console.log('✅ Database synced successfully');

    // Trigger rebuild if needed (Vercel will automatically detect changes)
    return res.status(200).json({ 
      message: 'Database synced successfully',
      size: s3Object.ContentLength,
      lastModified: s3Object.LastModified
    });

  } catch (error) {
    console.error('❌ Sync error:', error);
    return res.status(500).json({ 
      error: 'Failed to sync database',
      details: error.message 
    });
  }
}
