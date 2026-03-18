# AWS Infrastructure Setup for Job Watcher

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   AWS Lambda    │───▶│   AWS S3 Bucket   │───▶│   Vercel Site   │
│  (Job Scraper)  │    │ (jobs.db storage) │    │  (Frontend)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  CloudWatch     │    │   Vercel API     │    │   GitHub Repo   │
│   (Logs)        │    │  (Deployment)    │    │  (Code Sync)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 📋 Required AWS Services

### 1. **AWS Lambda**
- **Runtime**: Python 3.11
- **Memory**: 512 MB
- **Timeout**: 15 minutes
- **Trigger**: CloudWatch Events (scheduled)

### 2. **AWS S3**
- **Bucket**: `job-watcher-data`
- **Key**: `jobs.db`
- **Access**: Lambda only

### 3. **AWS IAM**
- **Role**: `JobWatcherLambdaRole`
- **Permissions**: S3 read/write, CloudWatch logs

### 4. **CloudWatch Events**
- **Schedule**: Rate(24 hours) or cron(0 17 * * ? *)
- **Target**: Lambda function

## 🔧 Setup Instructions

### Step 1: Create S3 Bucket
```bash
aws s3 mb s3://job-watcher-data
```

### Step 2: Create IAM Role
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::job-watcher-data",
        "arn:aws:s3:::job-watcher-data/*"
      ]
    }
  ]
}
```

### Step 3: Deploy Lambda Function
```bash
# Create deployment package
zip lambda_scraper.zip lambda_scraper.py

# Deploy Lambda
aws lambda create-function \
  --function-name job-scraper \
  --runtime python3.11 \
  --role arn:aws:iam::ACCOUNT:role/JobWatcherLambdaRole \
  --handler lambda_scraper.lambda_handler \
  --zip-file fileb://lambda_scraper.zip \
  --environment Variables={S3_BUCKET=job-watcher-data,S3_KEY=jobs.db,VERCEL_API_TOKEN=your_token,VERCEL_PROJECT_ID=your_project_id}
```

### Step 4: Set Up CloudWatch Schedule
```bash
aws events put-rule \
  --name job-scraper-schedule \
  --schedule-expression "cron(0 17 * * ? *)" \
  --description "Run job scraper daily at 5 PM"

aws lambda add-permission \
  --function-name job-scraper \
  --statement-id job-scraper-schedule \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:REGION:ACCOUNT:rule/job-scraper-schedule

aws targets put-rule \
  --rule job-scraper-schedule \
  --targets "Id"="1","Arn"="arn:aws:lambda:REGION:ACCOUNT:function:job-scraper"
```

## 🔧 Environment Variables

### Lambda Environment Variables
- `S3_BUCKET`: job-watcher-data
- `S3_KEY`: jobs.db
- `VERCEL_API_TOKEN`: Your Vercel API token
- `VERCEL_PROJECT_ID`: Your Vercel project ID
- `COMPANIES_JSON`: JSON string of companies (optional)

## 🚀 Vercel Integration

### Step 1: Get Vercel API Token
1. Go to Vercel dashboard
2. Settings → Tokens
3. Create new token
4. Copy token

### Step 2: Get Project ID
```bash
vercel projects ls
```

### Step 3: Update Frontend to Read from S3
Create `api/sync-db` route in your Vercel frontend:

```javascript
// pages/api/sync-db.js
import AWS from 'aws-sdk';

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: 'eu-west-1'
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get database from S3
    const s3Object = await s3.getObject({
      Bucket: 'job-watcher-data',
      Key: 'jobs.db'
    }).promise();

    // Save to local filesystem
    const fs = require('fs');
    fs.writeFileSync('./jobs.db', s3Object.Body);

    // Trigger rebuild
    await res.revalidate('/');

    res.status(200).json({ message: 'Database synced successfully' });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Failed to sync database' });
  }
}
```

## 📁 Files to Keep

### Essential Files (Move to AWS)
- `lambda_scraper.py` - Lambda function
- `companies.json` - Company list
- `deployment.yml` - Infrastructure as Code

### Frontend Files (Keep in GitHub/Vercel)
- `job-watcher-frontend/` - Next.js frontend
- `companies.json` - Copy for frontend
- `jobs.db` - Will be synced from S3

### Files to Remove
- `ghent_dynamic_job_watcher_improved.py` - Replaced by Lambda
- `deploy_database.py` - No longer needed
- `daily_update.bat` - Replaced by CloudWatch
- `jobwatch.log` - Use CloudWatch logs
- `venv/` - Not needed in Lambda

## 🔄 Updated Workflow

### Daily Automatic (5 PM)
1. **CloudWatch** triggers Lambda
2. **Lambda** scrapes all companies
3. **Lambda** uploads jobs.db to S3
4. **Lambda** triggers Vercel deployment
5. **Vercel** syncs database from S3
6. **Vercel** rebuilds and deploys site

### Manual Updates
```bash
# Update companies
aws lambda update-function-configuration \
  --function-name job-scraper \
  --environment Variables={COMPANIES_JSON='$(cat companies.json)'}

# Trigger manual run
aws lambda invoke \
  --function-name job-scraper \
  --payload '{}' \
  response.json
```

## 💰 Cost Estimate

### Monthly Costs (AWS Free Tier)
- **Lambda**: ~$0.20 (100k requests)
- **S3**: ~$0.02 (10GB storage)
- **CloudWatch**: ~$0.50 (logs)
- **Total**: ~$0.72/month

## 🎯 Benefits

✅ **Serverless** - No servers to manage
✅ **Scalable** - Auto-scales with needs
✅ **Reliable** - 99.99% uptime
✅ **Cost-effective** - Pay only for usage
✅ **Automated** - Runs automatically daily
✅ **Monitoring** - Built-in logging and metrics
✅ **Global** - Deploy to any AWS region

## 🚀 Next Steps

1. **Set up AWS account** (if not already)
2. **Create S3 bucket** and IAM role
3. **Deploy Lambda function**
4. **Configure CloudWatch schedule**
5. **Update Vercel frontend** to sync from S3
6. **Test end-to-end** workflow
7. **Clean up local files**

This architecture is much more robust and scalable than the local setup!
