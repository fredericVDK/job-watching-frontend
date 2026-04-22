# Job Watcher Frontend

A modern Next.js frontend for tracking job opportunities from tech companies.

## Features

- **Real-time Job Listings** - Live updates from SQLite database
- **Advanced Search** - Filter by title, company, or keywords  
- **Statistics Dashboard** - Track total jobs and companies
- **Location Support** - Display job locations (Remote, Belgium, etc.)
- **Responsive Design** - Works on all devices
- **Fast Performance** - Built with Next.js and Tailwind CSS

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript
- **Styling**: Tailwind CSS, Lucide Icons
- **Database**: SQLite with custom API routes
- **Deployment**: Ready for Vercel

## Project Structure

```
job-watcher-frontend/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── jobs/route.ts      # Job data API
│   │   │   └── stats/route.ts     # Statistics API
│   │   ├── page.tsx              # Main dashboard
│   │   └── layout.tsx            # App layout
│   ├── components/
│   │   ├── JobCard.tsx           # Job listing component
│   │   └── SearchBar.tsx         # Search functionality
│   ├── lib/
│   │   ├── database.ts            # SQLite integration
│   │   └── utils.ts              # Utility functions
│   └── types/
│       └── index.ts               # TypeScript types
├── public/
├── package.json
├── vercel.json                   # Vercel deployment config
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- SQLite database with job data

### Installation

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
