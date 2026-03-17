#!/usr/bin/env python3

from __future__ import annotations

import html
import json
import re
import smtplib
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional, Set

import requests
from bs4 import BeautifulSoup


# -----------------------------
# EMAIL CONFIG
# -----------------------------

JOBWATCH_EMAIL_FROM = "jobwatcher2026@gmail.com"
JOBWATCH_EMAIL_TO = "fredericvanderkeilen@yahoo.com"
JOBWATCH_SMTP_USER = "jobwatcher2026@gmail.com"
JOBWATCH_SMTP_PASSWORD = "ybboofbycvndfudn"
JOBWATCH_SMTP_SERVER = "smtp.gmail.com"
JOBWATCH_SMTP_PORT = 465


# -----------------------------
# CONFIG
# -----------------------------

DB_PATH = "jobs.db"
LOG_PATH = "jobwatch.log"

REQUEST_TIMEOUT = 30
REQUEST_DELAY_SECONDS = 2
MAX_WORKERS = 5  # Parallel processing

USER_AGENT = "GhentJobRadar/4.0"

KEYWORDS = [
    "backend", "backend engineer", "backend developer",
    "software engineer", "software developer", "python developer", "python engineer",
    "ai engineer", "machine learning", "ml engineer", "data engineer", "data scientist",
    "platform engineer", "cloud engineer", "full stack", "full-stack",
    "senior backend", "lead backend", "principal backend"
]

LOCATIONS = [
    "ghent", "belgium"
]

CAREER_PATHS = [
    # Standard paths
    "/careers", "/jobs", "/vacancies", "/join-us", "/open-positions",
    "/careers/", "/jobs/", "/vacancies/", "/join-us/", "/open-positions/",
    
    # Company-specific paths (like /company/careers)
    "/company/careers", "/company/jobs", "/company/vacancies", "/company/careers/",
    "/company/jobs/", "/company/vacancies/",
    
    # Alternative common paths
    "/work-with-us", "/work", "/opportunities", "/hiring", "/recruiting",
    "/work-with-us/", "/work/", "/opportunities/", "/hiring/", "/recruiting/",
    
    # European company paths
    "/karriere", "/jobs/ghent", "/jobs/belgium", "/vacatures", "/jobs/ghent/",
    "/jobs/belgium/", "/vacatures/",
    
    # Tech company specific
    "/engineering", "/tech-jobs", "/developer-jobs", "/engineering/",
    "/tech-jobs/", "/developer-jobs/",
    
    # Common variations
    "/career", "/job", "/vacancy", "/join", "/open-position",
    "/career/", "/job/", "/vacancy/", "/join/", "/open-position/",
    
    # Subdomain patterns (will be checked separately)
    "careers.", "jobs.", "hiring.", "recruitment."
]

# Job board patterns to detect different types of job listings
JOB_PATTERNS = [
    r'(?:job|position|vacancy|role)[\s-]*(?:opening|listing)',
    r'(?:senior|junior|lead|principal|staff)[\s-]*(?:engineer|developer)',
    r'(?:software|backend|frontend|full[-]?stack)[\s-]*(?:engineer|developer)',
    r'(?:data|machine[-]?learning|ai)[\s-]*(?:engineer|scientist)',
    r'(?:platform|cloud|devops)[\s-]*(?:engineer)',
]

HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}


# -----------------------------
# DATA STRUCTURES
# -----------------------------

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


# -----------------------------
# LOGGING
# -----------------------------

def log(message: str) -> None:
    """Enhanced logging with timestamps"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{timestamp}] {message}"
    print(line)
    
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")


# -----------------------------
# UTILITIES
# -----------------------------

def normalize_url(url: str) -> str:
    """Normalize and validate URLs - only fix scheme, don't strip paths"""
    if not url:
        return ""
    
    if not re.match(r"^https?://", url):
        url = "https://" + url
    
    return url


def is_valid_job_url(url: str) -> bool:
    """Check if URL looks like a specific job posting, not a general careers page"""
    job_indicators = [
        "/job/", "/jobs/", "/position/", "/vacancy/", "/role/",
        "/career/", "/careers/", "/opportunity/", "/opening/",
        "lever.co", "greenhouse.io", "recruitee.com", "applytojob.com",
        "jobvite.com", "workable.com", "bamboohr.com", "icims.com"
    ]
    
    url_lower = url.lower()
    return any(indicator in url_lower for indicator in job_indicators)


def text_matches_keywords(*parts: str) -> tuple[bool, str]:
    """Enhanced keyword matching with better scoring"""
    haystack = " ".join(parts).lower()
    
    for keyword in KEYWORDS:
        if keyword in haystack:
            return True, keyword
    
    return False, ""


def extract_location(text: str) -> str:
    """Extract location information from job text"""
    text_lower = text.lower()
    for location in LOCATIONS:
        if location in text_lower:
            return location
    return ""


def is_job_title(text: str) -> bool:
    """Check if text looks like a job title"""
    text_lower = text.lower().strip()
    
    # Must contain at least one keyword
    if not any(keyword in text_lower for keyword in KEYWORDS):
        return False
    
    # Must match job patterns
    for pattern in JOB_PATTERNS:
        if re.search(pattern, text_lower, re.IGNORECASE):
            return True
    
    # Common job title indicators
    job_indicators = ["engineer", "developer", "scientist", "manager", "lead", "senior", "junior"]
    return any(indicator in text_lower for indicator in job_indicators)


# -----------------------------
# DATABASE
# -----------------------------

def init_db() -> None:
    """Initialize database with better schema"""
    conn = sqlite3.connect(DB_PATH)
    
    conn.execute('''
        CREATE TABLE IF NOT EXISTS seen_jobs(
            url TEXT PRIMARY KEY,
            company TEXT,
            title TEXT,
            location TEXT,
            description TEXT,
            first_seen_at TEXT,
            keyword_matched TEXT
        )
    ''')
    
    # Add new columns if they don't exist (for backward compatibility)
    cursor = conn.execute("PRAGMA table_info(seen_jobs)")
    columns = [row[1] for row in cursor.fetchall()]
    
    if "location" not in columns:
        conn.execute("ALTER TABLE seen_jobs ADD COLUMN location TEXT")
    if "description" not in columns:
        conn.execute("ALTER TABLE seen_jobs ADD COLUMN description TEXT")
    if "keyword_matched" not in columns:
        conn.execute("ALTER TABLE seen_jobs ADD COLUMN keyword_matched TEXT")
    
    conn.commit()
    conn.close()


def already_seen(url: str) -> bool:
    """Check if job URL has been seen before"""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute("SELECT 1 FROM seen_jobs WHERE url=?", (url,))
    result = cur.fetchone()
    conn.close()
    return result is not None


def save_job(job: Job) -> None:
    """Save job with enhanced information"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''
        INSERT OR IGNORE INTO seen_jobs VALUES(?,?,?,?,?,?,?)
    ''', (
        job.url, job.company, job.title, job.location, 
        job.description, datetime.utcnow().isoformat(), job.matched_on
    ))
    conn.commit()
    conn.close()


# -----------------------------
# HTTP
# -----------------------------

def get_session() -> requests.Session:
    """Create enhanced HTTP session"""
    session = requests.Session()
    session.headers.update(HEADERS)
    
    # Retry configuration
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
    
    retry_strategy = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    
    return session


def safe_get(session: requests.Session, url: str) -> Optional[requests.Response]:
    """Enhanced HTTP request with better error handling"""
    try:
        response = session.get(url, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        return response
    except requests.exceptions.RequestException as e:
        log(f"GET failed {url}: {e}")
        return None


# -----------------------------
# JSON COMPANY LOADING
# -----------------------------

def load_companies_from_json(path: str = "companies.json") -> List[Company]:
    """Load companies with validation"""
    log(f"Loading companies from {path}")
    
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        companies = []
        for c in data.get("companies", []):
            name = c.get("name")
            website = c.get("website")
            
            if name and website:
                companies.append(Company(
                    name=name,
                    website=normalize_url(website)
                ))
        
        log(f"Loaded {len(companies)} companies")
        return companies
    
    except Exception as e:
        log(f"Error loading companies: {e}")
        return []


# -----------------------------
# CAREERS PAGE DETECTION
# -----------------------------

def find_careers_page(session: requests.Session, company: Company) -> Optional[Company]:
    """Enhanced careers page detection with dynamic search"""
    log(f"Searching for careers page at {company.website}")
    
    home = safe_get(session, company.website)
    if not home:
        log(f"Failed to load homepage for {company.name}")
        return None
    
    soup = BeautifulSoup(home.text, "html.parser")
    
    # Priority 1: Look for explicit careers links in navigation and main content
    careers_keywords = ["career", "job", "vacanc", "work", "join", "hiring", "opportunit", "recruit"]
    
    # Check navigation menus first (most likely place)
    nav_links = soup.find_all("nav") + soup.find_all("header") + soup.find_all("footer")
    for nav in nav_links:
        for a in nav.find_all("a", href=True):
            text = a.get_text(" ").lower().strip()
            href = a["href"].lower()
            
            # Check if link text or href contains careers keywords
            if any(keyword in text for keyword in careers_keywords) or any(keyword in href for keyword in careers_keywords):
                url = normalize_url(urljoin(home.url, a["href"]))
                log(f"Found careers link in navigation: {url}")
                
                # Verify this is actually a careers page
                test_resp = safe_get(session, url)
                if test_resp and test_resp.status_code == 200:
                    test_soup = BeautifulSoup(test_resp.text, "html.parser")
                    # Check if page contains job-related content
                    page_text = test_soup.get_text().lower()
                    if any(keyword in page_text for keyword in ["position", "vacanc", "job", "role", "opening", "apply"]):
                        return Company(company.name, company.website, url)
    
    # Priority 2: Look for careers links anywhere on the page
    for a in soup.find_all("a", href=True):
        text = a.get_text(" ").lower().strip()
        href = a["href"].lower()
        
        # More specific matching
        if any(term in text for term in careers_keywords) and len(text) < 50:  # Avoid long text blocks
            url = normalize_url(urljoin(home.url, a["href"]))
            log(f"Found potential careers link: {url}")
            
            # Verify this is actually a careers page
            test_resp = safe_get(session, url)
            if test_resp and test_resp.status_code == 200:
                return Company(company.name, company.website, url)
    
    # Priority 3: Try common career paths (most likely first)
    priority_paths = [
        "/company/careers", "/careers", "/jobs", "/vacancies", "/join-us",
        "/company/careers/", "/careers/", "/jobs/", "/vacancies/", "/join-us/",
        "/work-with-us", "/opportunities", "/hiring"
    ]
    
    for path in priority_paths:
        url = normalize_url(urljoin(company.website, path))
        resp = safe_get(session, url)
        if resp and resp.status_code == 200:
            log(f"Found careers page at common path: {url}")
            return Company(company.name, company.website, url)
    
    # Priority 4: Try all remaining paths
    remaining_paths = [path for path in CAREER_PATHS if path not in priority_paths]
    for path in remaining_paths:
        url = normalize_url(urljoin(company.website, path))
        resp = safe_get(session, url)
        if resp and resp.status_code == 200:
            log(f"Found careers page at alternative path: {url}")
            return Company(company.name, company.website, url)
    
    # Priority 5: Try subdomain patterns
    from urllib.parse import urlparse
    parsed = urlparse(company.website)
    base_domain = parsed.netloc
    
    subdomains = ["careers", "jobs", "hiring", "recruitment", "careers"]
    for subdomain in subdomains:
        if subdomain not in base_domain:
            subdomain_url = f"https://{subdomain}.{base_domain}"
            resp = safe_get(session, subdomain_url)
            if resp and resp.status_code == 200:
                log(f"Found careers subdomain: {subdomain_url}")
                return Company(company.name, company.website, subdomain_url)
    
    log(f"No careers page found for {company.name}")
    return None


# -----------------------------
# JOB SCRAPER
# -----------------------------

def extract_job_details(session: requests.Session, job_url: str) -> Optional[dict]:
    """Extract detailed information from a specific job posting"""
    try:
        resp = safe_get(session, job_url)
        if not resp:
            return None
        
        soup = BeautifulSoup(resp.text, "html.parser")
        
        # Extract job description
        description = ""
        for tag in soup.find_all(['div', 'section', 'article']):
            if any(cls in tag.get('class', []) for cls in ['description', 'requirements', 'about', 'what-youll-do']):
                description = tag.get_text(" ", strip=True)[:500]  # Limit length
                break
        
        if not description:
            # Fallback to common patterns
            for selector in ['.job-description', '#job-description', '[data-testid="job-description"]']:
                elem = soup.select_one(selector)
                if elem:
                    description = elem.get_text(" ", strip=True)[:500]
                    break
        
        return {"description": description}
    
    except Exception as e:
        log(f"Error extracting job details from {job_url}: {e}")
        return None


def scrape_jobs(session: requests.Session, company: Company) -> List[Job]:
    """Enhanced job scraper with better link extraction"""
    resp = safe_get(session, company.careers_url)
    if not resp:
        return []
    
    soup = BeautifulSoup(resp.text, "html.parser")
    jobs = []
    processed_urls: Set[str] = set()
    
    log(f"Scraping {len(soup.find_all('a', href=True))} links from {company.careers_url}")
    
    # Find all job links with better detection
    for a in soup.find_all("a", href=True):
        href = a["href"]
        full_url = normalize_url(urljoin(resp.url, href))
        text = a.get_text(" ").strip()
        
        # Skip if already processed
        if full_url in processed_urls:
            continue
        
        # Check if this looks like a specific job posting, not a general page
        if not is_specific_job_posting(full_url, text):
            continue
        
        # Check if it's a job title
        if not is_job_title(text):
            continue
        
        # Check keyword matching
        matched, keyword = text_matches_keywords(text, full_url)
        if not matched:
            continue
        
        log(f"Found potential job: {text} at {full_url}")
        
        # Extract location from the link text or surrounding context
        location = extract_location(text)
        
        # Get additional job details
        details = extract_job_details(session, full_url)
        description = details.get("description", "") if details else ""
        
        jobs.append(Job(
            company=company.name,
            title=text,
            url=full_url,
            location=location,
            matched_on=keyword,
            description=description
        ))
        
        processed_urls.add(full_url)
        
        # Add small delay to be respectful
        time.sleep(0.1)
    
    log(f"Found {len(jobs)} matching jobs at {company.name}")
    return jobs


def is_specific_job_posting(url: str, title: str) -> bool:
    """Check if URL looks like a specific job posting, not a general careers page"""
    url_lower = url.lower()
    title_lower = title.lower()
    
    # Job board domains that indicate specific postings
    job_board_indicators = [
        "lever.co", "greenhouse.io", "recruitee.com", "applytojob.com",
        "jobvite.com", "workable.com", "bamboohr.com", "icims.com",
        "smartrecruiters.com", "ashbyhq.com", "teamtailor.com"
    ]
    
    # URL patterns that indicate specific jobs
    specific_job_patterns = [
        r"/job[s]?/", r"/position[s]?/", r"/vacanc[y]?/", r"/role[s]?/",
        r"/opportunity/", r"/opening[s]?/", r"/career[s]?/",
        r"/o/",  # Recruitee specific pattern
        r"\d+$",  # URLs ending in numbers (often job IDs)
        r"/apply", r"/view", r"/details"
    ]
    
    # If it's a known job board, check for specific job patterns
    if any(board in url_lower for board in job_board_indicators):
        # For job boards, look for specific job indicators
        return any(
            re.search(pattern, url_lower) or 
            re.search(pattern, title_lower)
            for pattern in specific_job_patterns
        )
    
    # For other sites, check if the URL has job-specific patterns
    return any(re.search(pattern, url_lower) for pattern in specific_job_patterns)


# -----------------------------
# LINKEDIN SCRAPING
# -----------------------------

def scrape_linkedin_jobs(session: requests.Session) -> List[Job]:
    """Scrape LinkedIn for jobs in Ghent with matching keywords"""
    log("Starting LinkedIn job scraping...")
    
    jobs = []
    
    # LinkedIn job search URL for Ghent, Belgium
    # Using LinkedIn's job search API endpoint
    search_queries = []
    
    # Create search queries for each keyword
    for keyword in KEYWORDS:
        query = f"{keyword} Ghent Belgium"
        encoded_query = requests.utils.quote(query)
        linkedin_url = f"https://www.linkedin.com/jobs/search?keywords={encoded_query}&location=Ghent%2C%20Belgium&f_TPR=r86400&f_E=2%2C3"  # Past 24 hours, entry level to senior
        
        search_queries.append({
            'keyword': keyword,
            'url': linkedin_url
        })
    
    # Process each search query
    for query_info in search_queries:
        try:
            log(f"Searching LinkedIn for: {query_info['keyword']}")
            
            # Add headers to look more like a real browser
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            }
            
            response = session.get(query_info['url'], headers=headers, timeout=REQUEST_TIMEOUT)
            
            if response.status_code == 429:
                log("LinkedIn rate limited, waiting...")
                time.sleep(60)  # Wait 1 minute if rate limited
                continue
                
            if response.status_code != 200:
                log(f"LinkedIn search failed with status {response.status_code}")
                continue
            
            soup = BeautifulSoup(response.text, "html.parser")
            
            # Look for job cards
            job_cards = soup.find_all('div', class_='base-card')
            
            for card in job_cards:
                try:
                    # Extract job title
                    title_elem = card.find('h3', class_='base-search-card__title')
                    if not title_elem:
                        continue
                    
                    title = title_elem.get_text().strip()
                    
                    # Extract company name
                    company_elem = card.find('h4', class_='base-search-card__subtitle')
                    company = company_elem.get_text().strip() if company_elem else "Unknown Company"
                    
                    # Extract job link
                    link_elem = card.find('a', class_='base-card__full-link')
                    if not link_elem:
                        continue
                    
                    job_url = link_elem.get('href')
                    if job_url.startswith('/'):
                        job_url = 'https://www.linkedin.com' + job_url
                    
                    # Check if location matches
                    location_elem = card.find('span', class_='job-result-card__location')
                    location = location_elem.get_text().strip() if location_elem else ""
                    
                    # Check if location contains Ghent or Belgium
                    if not any(loc.lower() in location.lower() for loc in LOCATIONS):
                        continue
                    
                    # Check if title matches keywords
                    if not text_matches_keywords(title, job_url)[0]:
                        continue
                    
                    # Extract posting date
                    date_elem = card.find('time', class_='job-result-card__listdate')
                    posted_date = date_elem.get('datetime') if date_elem else datetime.now().isoformat()
                    
                    log(f"Found LinkedIn job: {title} at {company}")
                    
                    jobs.append(Job(
                        company=company,
                        title=title,
                        url=job_url,
                        location=location,
                        matched_on=query_info['keyword'],
                        description=""
                    ))
                    
                    # Add delay to be respectful
                    time.sleep(2)
                    
                except Exception as e:
                    log(f"Error parsing LinkedIn job card: {e}")
                    continue
            
            # Add delay between searches
            time.sleep(REQUEST_DELAY_SECONDS * 2)
            
        except Exception as e:
            log(f"Error in LinkedIn search for {query_info['keyword']}: {e}")
            continue
    
    log(f"Found {len(jobs)} jobs on LinkedIn")
    return jobs


# -----------------------------
# EMAIL
# -----------------------------

def email_is_configured() -> bool:
    """Check if email configuration is complete"""
    return all([
        JOBWATCH_EMAIL_FROM, JOBWATCH_EMAIL_TO,
        JOBWATCH_SMTP_USER, JOBWATCH_SMTP_PASSWORD
    ])


def send_email(jobs: List[Job]) -> None:
    """Send enhanced email with job details"""
    msg = MIMEMultipart()
    msg["Subject"] = f"New Ghent job matches: {len(jobs)}"
    msg["From"] = JOBWATCH_EMAIL_FROM
    msg["To"] = JOBWATCH_EMAIL_TO
    
    text = "New matching jobs:\n\n"
    for job in jobs:
        text += f"{job.company} — {job.title}\n"
        if job.location:
            text += f"Location: {job.location}\n"
        text += f"{job.url}\n"
        if job.description:
            text += f"Description: {job.description[:200]}...\n"
        text += "\n"
    
    msg.attach(MIMEText(text, "plain"))
    
    try:
        with smtplib.SMTP_SSL(JOBWATCH_SMTP_SERVER, JOBWATCH_SMTP_PORT) as server:
            server.login(JOBWATCH_SMTP_USER, JOBWATCH_SMTP_PASSWORD)
            server.sendmail(JOBWATCH_EMAIL_FROM, [JOBWATCH_EMAIL_TO], msg.as_string())
        log(f"Email sent with {len(jobs)} jobs.")
    except Exception as e:
        log(f"Failed to send email: {e}")


# -----------------------------
# OUTPUT
# -----------------------------

def print_matches(jobs: List[Job]) -> None:
    """Enhanced job matching output"""
    if not jobs:
        log("No matching jobs found.")
        return
    
    log(f"New jobs found: {len(jobs)}")
    for job in jobs:
        log(f"✓ {job.company} — {job.title}")
        if job.location:
            log(f"  📍 {job.location}")
        log(f"  🔗 {job.url}")
        if job.matched_on:
            log(f"  🎯 Matched on: {job.matched_on}")
        log("")


# -----------------------------
# MAIN
# -----------------------------

def process_company(session: requests.Session, company: Company) -> tuple[str, List[Job]]:
    """Process a single company and return results"""
    log(f"Processing {company.name}")
    
    # Special handling for LinkedIn
    if company.name == "LinkedIn":
        log("Processing LinkedIn job search...")
        linkedin_jobs = scrape_linkedin_jobs(session)
        
        # Filter out already seen jobs
        new_jobs = []
        for job in linkedin_jobs:
            if not already_seen(job.url):
                log(f"New LinkedIn job found: {job.title} - saving to database")
                save_job(job)
                new_jobs.append(job)
            else:
                log(f"LinkedIn job already seen: {job.title}")
        
        return company.name, new_jobs
    
    # Find careers page if not already set
    if not company.careers_url:
        resolved = find_careers_page(session, company)
        if resolved:
            company = resolved
            log(f"Found careers page: {company.careers_url}")
        else:
            log(f"No careers page found for {company.name}")
            return company.name, []
    
    # Scrape jobs
    jobs = scrape_jobs(session, company)
    
    # Filter out already seen jobs
    new_jobs = []
    for job in jobs:
        if not already_seen(job.url):
            log(f"New job found: {job.title} - saving to database")
            save_job(job)
            new_jobs.append(job)
        else:
            log(f"Job already seen: {job.title}")
    
    return company.name, new_jobs


def main() -> None:
    """Enhanced main function with parallel processing"""
    log("Enhanced Job Watcher script started")
    
    init_db()
    session = get_session()
    
    # Load companies
    companies = load_companies_from_json("companies.json")
    if not companies:
        log("No companies loaded, exiting")
        return
    
    # Process companies in parallel
    all_new_jobs = []
    
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        # Submit all companies for processing
        future_to_company = {
            executor.submit(process_company, session, company): company
            for company in companies
        }
        
        # Collect results as they complete
        for future in as_completed(future_to_company):
            company_name, new_jobs = future.result()
            if new_jobs:
                all_new_jobs.extend(new_jobs)
                log(f"Found {len(new_jobs)} new jobs at {company_name}")
            
            # Add delay between completions to be respectful
            time.sleep(REQUEST_DELAY_SECONDS)
    
    # Output results
    print_matches(all_new_jobs)
    
    # Send email if configured and jobs found
    if all_new_jobs and email_is_configured():
        send_email(all_new_jobs)
    
    log(f"Script finished. Total new jobs: {len(all_new_jobs)}")


if __name__ == "__main__":
    main()
