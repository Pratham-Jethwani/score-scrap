# Instagram Profile & Metadata Scraper

A high-fidelity Node.js + TypeScript scraper and REST API that retrieves all available metadata for any Instagram username according to account classification:
- **Business / Creator Accounts**
- **Public Personal Accounts**
- **Private Accounts**

---

## Features

- **Zero-Login Public Extraction**: Extracts profile metadata without requiring Instagram user credentials.
- **Deep Metrics Support**: Option to fetch exact likes count, comments count, and posting timestamps for recent posts.
- **Account Type Classification**: Automatically detects whether an account is `BUSINESS_OR_CREATOR`, `PUBLIC_PERSONAL`, or `PRIVATE`.
- **Exact Numeric Precision**: Extracts exact integer follower and following counts directly from Instagram's internal JSON store (e.g. `17,348,110` instead of a rounded `17M`).
- **REST API + CLI + Web UI**: Ready to run as a terminal command, Express server, or deployed on Netlify.

---

## Output Schema

```json
{
  "username": "zuck",
  "fullName": "Mark Zuckerberg",
  "pk": "314216",
  "metaId": "17841401746480004",
  "biography": "I build stuff",
  "followersCount": 17348110,
  "followingCount": 625,
  "postsCount": 446,
  "isVerified": true,
  "isPrivate": false,
  "isBusinessAccount": true,
  "accountType": "BUSINESS_OR_CREATOR",
  "profilePicUrl": "https://scontent.cdninstagram.com/...",
  "hasAnyClips": true,
  "latestReelTimestamp": null,
  "recentPosts": [
    {
      "shortcode": "DeZgzTEggQe",
      "permalink": "https://www.instagram.com/p/DeZgzTEggQe/",
      "caption": "Muse ordered me 🍉 how thoughtful!",
      "imageUrl": "https://instagram.fpnq7-6.fna.fbcdn.net/...",
      "likesCount": 564000,
      "commentsCount": 181000,
      "postedAt": "October 12, 2026"
    }
  ],
  "fetchedAt": "2026-10-19T10:13:08.123Z",
  "dataSource": "web_scraper"
}
```

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Run via CLI
```bash
# Basic profile extraction
npx tsx src/cli.ts <username>

# Deep metrics (fetches likes, comments, and dates for recent posts)
npx tsx src/cli.ts <username> --deep

# Raw JSON output
npx tsx src/cli.ts <username> --json
```

### 3. Run as Local Web App & REST API
```bash
npm run dev
```

Server starts on `http://localhost:3000`.
