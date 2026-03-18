# AWS DynamoDB Lambda Scraper

import json
import boto3
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone
import os
import logging
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
from dataclasses import dataclass
from typing import List, Optional, Set
from boto3.dynamodb.conditions import Key

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Configuration
KEYWORDS = [
    "backend", "backend engineer", "backend developer",
    "software engineer", "software developer", "python developer", "python engineer",
    "ai engineer", "machine learning", "ml engineer", "data engineer", "data scientist",
    "platform engineer", "cloud engineer", "full stack", "full-stack",
    "senior backend", "lead backend", "principal backend"
]

LOCATIONS = ["ghent", "belgium"]

CAREER_PATHS = [
    "/careers", "/jobs", "/vacancies", "/join-us", "/open-positions",
    "/careers/", "/jobs/", "/vacancies/", "/join-us/", "/open-positions/",
    "/company/careers", "/company/jobs", "/company/vacancies", "/company/careers/",
    "/company/jobs/", "/company/vacancies/",
    "/work-with-us", "/work", "/opportunities", "/hiring", "/recruiting",
    "/work-with-us/", "/work/", "/opportunities/", "/hiring/", "/recruiting/",
    "/karriere", "/jobs/ghent", "/jobs/belgium", "/vacatures", "/jobs/ghent/",
    "/jobs/belgium/", "/vacatures/",
    "/engineering", "/tech-jobs", "/developer-jobs", "/engineering/",
    "/tech-jobs/", "/developer-jobs/",
    "/career", "/job", "/vacancy", "/join", "/open-position",
    "/career/", "/job/", "/vacancy/", "/join/", "/open-position/"
]

# DynamoDB configuration
DYNAMODB_REGION = os.environ.get('AWS_REGION', 'eu-west-1')
JOBS_TABLE = os.environ.get('JOBS_TABLE', 'jobs')
COMPANIES_TABLE = os.environ.get('COMPANIES_TABLE', 'companies')

# Vercel API configuration
VERCEL_API_TOKEN = os.environ.get('VERCEL_API_TOKEN')
VERCEL_PROJECT_ID = os.environ.get('VERCEL_PROJECT_ID')

# Initialize DynamoDB
dynamodb = boto3.resource('dynamodb', region_name=DYNAMODB_REGION)
jobs_table = dynamodb.Table(JOBS_TABLE)
companies_table = dynamodb.Table(COMPANIES_TABLE)

@dataclass(frozen=True)
class Company:
    name: str
    website: str
    careers_url: str = ""

@dataclass(frozen=True)
class Job:
    company: str
    title: str
    url: str
    location: str = ""
    matched_on: str = ""
    description: str = ""

def lambda_handler(event, context):
    """Main Lambda handler"""
    logger.info("Starting DynamoDB job scraper Lambda function")
    
    try:
        # Load companies
        companies = load_companies()
        
        # Scrape jobs
        session = get_session()
        all_new_jobs = []
        
        # Process companies in parallel (limited for Lambda)
        with ThreadPoolExecutor(max_workers=3) as executor:
            future_to_company = {
                executor.submit(process_company, session, company): company
                for company in companies[:20]  # Limit for Lambda execution time
            }
            
            for future in as_completed(future_to_company):
                company_name, new_jobs = future.result()
                if new_jobs:
                    all_new_jobs.extend(new_jobs)
                    logger.info(f"Found {len(new_jobs)} new jobs at {company_name}")
        
        # Save jobs to DynamoDB
        save_jobs_to_dynamodb(all_new_jobs)
        
        # Update companies table
        update_companies_table(companies[:20])
        
        # Trigger Vercel deployment (optional - not needed with DynamoDB)
        if VERCEL_API_TOKEN and VERCEL_PROJECT_ID:
            trigger_vercel_deployment()
        
        # Send notification (optional)
        if all_new_jobs:
            send_notification(all_new_jobs)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Job scraping completed successfully',
                'total_new_jobs': len(all_new_jobs),
                'companies_processed': len(companies[:20]),
                'database': 'DynamoDB'
            })
        }
        
    except Exception as e:
        logger.error(f"Error in Lambda function: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e)
            })
        }

def load_companies():
    """Load companies from environment variable or use default"""
    companies_json = os.environ.get('COMPANIES_JSON', '')
    
    if companies_json:
        return json.loads(companies_json)
    
    # Default companies list
    return [
        {"name": "Showpad", "website": "https://showpad.com"},
        {"name": "Teamleader", "website": "https://teamleader.eu"},
        {"name": "TechWolf", "website": "https://techwolf.ai"},
        {"name": "Aikido Security", "website": "https://aikido.dev"},
        {"name": "Bothive", "website": "https://bothive.be"},
        {"name": "StoryChief", "website": "https://storychief.io"},
        {"name": "Waylay", "website": "https://waylay.io"},
        {"name": "Uman", "website": "https://uman.ai"},
        {"name": "Cheqroom", "website": "https://cheqroom.com"},
        {"name": "TapCrowd", "website": "https://tapcrowd.com"},
        {"name": "Journy", "website": "https://journy.io"},
        {"name": "Robovision", "website": "https://robovision.ai"},
        {"name": "OTIV", "website": "https://otiv.ai"},
        {"name": "Rombit", "website": "https://rombit.com"},
        {"name": "ML6", "website": "https://ml6.eu"},
        {"name": "In The Pocket", "website": "https://inthepocket.com"},
        {"name": "Silverfin", "website": "https://silverfin.com"},
        {"name": "Lighthouse", "website": "https://lighthouseapp.com"},
        {"name": "SweepBright", "website": "https://sweepbright.com"},
        {"name": "Whale", "website": "https://usewhale.io"}
    ]

def get_session():
    """Create HTTP session with headers"""
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    })
    return session

def safe_get(session, url, timeout=30):
    """Safe HTTP GET request"""
    try:
        response = session.get(url, timeout=timeout)
        response.raise_for_status()
        return response
    except Exception as e:
        logger.warning(f"GET failed {url}: {str(e)}")
        return None

def find_careers_page(session, company):
    """Find careers page for a company"""
    home = safe_get(session, company.website)
    if not home:
        return None
    
    soup = BeautifulSoup(home.text, "html.parser")
    
    # Look for careers links in navigation
    careers_keywords = ["career", "job", "vacanc", "work", "join", "hiring", "opportunit", "recruit"]
    
    nav_links = soup.find_all("nav") + soup.find_all("header") + soup.find_all("footer")
    for nav in nav_links:
        for a in nav.find_all("a", href=True):
            text = a.get_text(" ").lower().strip()
            href = a["href"].lower()
            
            if any(keyword in text for keyword in careers_keywords) or any(keyword in href for keyword in careers_keywords):
                url = urljoin(home.url, a["href"])
                return Company(company.name, company.website, url)
    
    # Try common paths
    for path in CAREER_PATHS[:10]:  # Limit for Lambda
        url = urljoin(company.website, path)
        resp = safe_get(session, url)
        if resp and resp.status_code == 200:
            return Company(company.name, company.website, url)
    
    return None

def text_matches_keywords(text, url):
    """Check if text matches keywords"""
    text_lower = text.lower()
    url_lower = url.lower()
    
    for keyword in KEYWORDS:
        if keyword in text_lower or keyword in url_lower:
            return True, keyword
    
    return False, ""

def process_company(session, company, db_path=None):
    """Process a single company"""
    logger.info(f"Processing {company.name}")
    
    # Find careers page
    if not company.careers_url:
        resolved = find_careers_page(session, company)
        if resolved:
            company = resolved
            logger.info(f"Found careers page: {company.careers_url}")
        else:
            logger.info(f"No careers page found for {company.name}")
            return company.name, []
    
    # Scrape jobs
    jobs = scrape_jobs(session, company)
    
    return company.name, jobs

def scrape_jobs(session, company):
    """Scrape jobs from company careers page"""
    resp = safe_get(session, company.careers_url)
    if not resp:
        return []
    
    soup = BeautifulSoup(resp.text, "html.parser")
    jobs = []
    processed_urls = set()
    
    for a in soup.find_all("a", href=True):
        href = a["href"]
        full_url = urljoin(resp.url, href)
        text = a.get_text(" ").strip()
        
        if full_url in processed_urls or len(text) > 100:
            continue
        
        matched, keyword = text_matches_keywords(text, full_url)
        if not matched:
            continue
        
        jobs.append(Job(
            company=company.name,
            title=text,
            url=full_url,
            location="",
            matched_on=keyword,
            description=""
        ))
        
        processed_urls.add(full_url)
        time.sleep(0.1)  # Be respectful
    
    logger.info(f"Found {len(jobs)} matching jobs at {company.name}")
    return jobs

def save_jobs_to_dynamodb(jobs):
    """Save jobs to DynamoDB table"""
    logger.info(f"Saving {len(jobs)} jobs to DynamoDB")
    
    for job in jobs:
        try:
            # Check if job already exists
            response = jobs_table.get_item(
                Key={
                    'url': job.url,
                    'company': job.company
                }
            )
            
            if 'Item' not in response:
                # New job - insert it
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
                logger.info(f"New job: {job.title} at {job.company}")
            else:
                # Existing job - update last_updated
                jobs_table.update_item(
                    Key={
                        'url': job.url,
                        'company': job.company
                    },
                    UpdateExpression="SET last_updated = :updated",
                    ExpressionAttributeValues={
                        ':updated': datetime.now(timezone.utc).isoformat()
                    }
                )
                
        except Exception as e:
            logger.error(f"Error saving job {job.url}: {str(e)}")
            continue

def update_companies_table(companies):
    """Update companies table with last scraped timestamp"""
    logger.info(f"Updating companies table with {len(companies)} companies")
    
    for company in companies:
        try:
            companies_table.put_item(
                Item={
                    'name': company.name,
                    'website': company.website,
                    'careers_url': company.careers_url or '',
                    'last_scraped': datetime.now(timezone.utc).isoformat(),
                    'is_active': True
                }
            )
        except Exception as e:
            logger.error(f"Error updating company {company.name}: {str(e)}")
            continue

def trigger_vercel_deployment():
    """Trigger Vercel deployment via API (optional)"""
    if not VERCEL_API_TOKEN or not VERCEL_PROJECT_ID:
        logger.warning("Vercel API credentials not configured")
        return
    
    try:
        response = requests.post(
            f"https://api.vercel.com/v13/deployments",
            headers={
                'Authorization': f'Bearer {VERCEL_API_TOKEN}',
                'Content-Type': 'application/json'
            },
            json={
                'projectId': VERCEL_PROJECT_ID,
                'target': 'production'
            }
        )
        
        if response.status_code == 200:
            logger.info("Vercel deployment triggered successfully")
        else:
            logger.warning(f"Failed to trigger Vercel deployment: {response.text}")
    
    except Exception as e:
        logger.error(f"Error triggering Vercel deployment: {str(e)}")

def send_notification(jobs):
    """Send notification about new jobs"""
    # Implement your notification logic here (SNS, email, etc.)
    logger.info(f"Found {len(jobs)} new jobs")
    for job in jobs[:5]:  # Log first 5 jobs
        logger.info(f"New job: {job.title} at {job.company}")
