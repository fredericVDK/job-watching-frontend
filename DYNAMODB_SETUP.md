# AWS DynamoDB Job Watcher Architecture

## 🏗️ Recommended Architecture

```
CloudWatch (5 PM) 
    ↓
AWS Lambda (scraper)
    ↓
AWS DynamoDB (jobs table)
    ↓
Vercel API Routes (/api/jobs, /api/stats)
    ↓
Vercel Frontend (React/Next.js)
```

## 📊 DynamoDB Table Design

### Table: `jobs`
```
Partition Key: url (String)
Sort Key: company (String)
Attributes:
  - title (String)
  - location (String)
  - matched_on (String)
  - description (String)
  - first_seen_at (String)
  - last_updated (String)
  - is_active (Boolean)
```

### Table: `companies`
```
Partition Key: name (String)
Attributes:
  - website (String)
  - careers_url (String)
  - last_scraped (String)
  - is_active (Boolean)
```

## 🚀 Benefits of DynamoDB

✅ **Serverless** - No servers to manage
✅ **Fast** - Single-digit millisecond latency
✅ **Scalable** - Auto-scales to millions of requests
✅ **Cheap** - Pay per request
✅ **Integrated** - Native AWS integration
✅ **Real-time** - Direct access from Vercel APIs
✅ **Secure** - IAM-based access control

## 💰 Cost Comparison

### Current (S3 + API calls)
- **S3**: $0.02/month
- **Lambda**: $0.20/month
- **Vercel API calls**: ~$5/month
- **Total**: ~$5.22/month

### DynamoDB (Direct access)
- **DynamoDB**: ~$1.25/month (1M reads/writes)
- **Lambda**: $0.20/month
- **Vercel API calls**: ~$2/month (reduced)
- **Total**: ~$3.45/month

## 🔧 Implementation

### Step 1: Create DynamoDB Tables
```bash
# Create jobs table
aws dynamodb create-table \
  --table-name jobs \
  --attribute-definitions \
    AttributeName=url,AttributeType=S \
    AttributeName=company,AttributeType=S \
  --key-schema \
    AttributeName=url,KeyType=HASH \
    AttributeName=company,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region eu-west-1

# Create companies table
aws dynamodb create-table \
  --table-name companies \
  --attribute-definitions \
    AttributeName=name,AttributeType=S \
  --key-schema \
    AttributeName=name,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region eu-west-1
```

### Step 2: Update Lambda to Use DynamoDB
```python
import boto3
from boto3.dynamodb.conditions import Key

# DynamoDB client
dynamodb = boto3.resource('dynamodb')
jobs_table = dynamodb.Table('jobs')
companies_table = dynamodb.Table('companies')

def save_job(job):
    """Save job to DynamoDB"""
    jobs_table.put_item(
        Item={
            'url': job.url,
            'company': job.company,
            'title': job.title,
            'location': job.location,
            'matched_on': job.matched_on,
            'description': job.description,
            'first_seen_at': datetime.now(timezone.utc).isoformat(),
            'last_updated': datetime.now(timezone.utc).isoformat(),
            'is_active': True
        }
    )

def get_all_jobs():
    """Get all jobs from DynamoDB"""
    response = jobs_table.scan()
    return response.get('Items', [])
```

### Step 3: Update Vercel API Routes
```javascript
// pages/api/jobs.js
import AWS from 'aws-sdk';

const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'eu-west-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const params = {
        TableName: 'jobs',
        FilterExpression: 'is_active = :active',
        ExpressionAttributeValues: {
          ':active': true
        }
      };

      const result = await dynamodb.scan(params).promise();
      
      return res.status(200).json({
        jobs: result.Items,
        total: result.Items.length
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
}
```

### Step 4: Frontend (No Changes Needed)
Your frontend already calls `/api/jobs`, so no changes needed!

## 🔄 Updated Workflow

### Daily Scraping (5 PM)
1. **CloudWatch** triggers Lambda
2. **Lambda** scrapes companies
3. **Lambda** saves jobs to DynamoDB
4. **Lambda** updates companies table

### Real-time Access
1. **User visits website**
2. **Frontend** calls `/api/jobs`
3. **Vercel API** queries DynamoDB directly
4. **Data** returned instantly

## 🚀 Migration Steps

### Step 1: Set up DynamoDB
```bash
# Create tables
./create_dynamodb_tables.sh
```

### Step 2: Update Lambda
```bash
# Deploy updated Lambda
zip lambda_scraper.zip lambda_scraper.py
aws lambda update-function-code \
  --function-name job-scraper \
  --zip-file fileb://lambda_scraper.zip
```

### Step 3: Update Vercel
```bash
# Add AWS credentials to Vercel
# Deploy updated API routes
vercel --prod
```

### Step 4: Test
```bash
# Test DynamoDB access
curl https://your-site.vercel.app/api/jobs

# Check Lambda logs
aws logs tail /aws/lambda/job-scraper --follow
```

## 📊 Performance Comparison

### Current (S3 + API calls)
- **Latency**: ~500ms (S3 download + parse)
- **Throughput**: Limited by S3 API
- **Scalability**: Good but not real-time

### DynamoDB (Direct access)
- **Latency**: ~10ms (direct database query)
- **Throughput**: Millions of requests/second
- **Scalability**: Excellent, auto-scales

## 🎯 Recommendation

**Go with DynamoDB** because:
- ✅ Faster performance (10ms vs 500ms)
- ✅ Cheaper (~$3.45 vs ~$5.22)
- ✅ More scalable
- ✅ Better integration with AWS
- ✅ Real-time data access
- ✅ No file management

## 🔄 Frontend Benefits

Your frontend will benefit from:
- **Faster loading** - Direct database access
- **Real-time updates** - No cache delays
- **Better search** - Database queries vs file parsing
- **Reliability** - No file corruption issues
- **Scalability** - Handles thousands of jobs easily

**The best part: Your frontend code doesn't need to change at all!** It still calls `/api/jobs` just like before.
