import * as cheerio from 'cheerio';
import { InstagramProfile, InstagramPost, ScrapeOptions, AccountType } from '../types/instagram.js';
import { extractShortcodeFromImageUrl, parseCompactNumber } from '../utils/shortcode.js';

const USER_AGENTS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
];

export class InstagramWebScraper {
  /**
   * Main method to scrape public metadata for an Instagram user
   */
  async scrapeProfile(rawUsername: string, options: ScrapeOptions = {}): Promise<InstagramProfile> {
    const username = rawUsername.trim().toLowerCase().replace(/^@/, '');
    const url = `https://www.instagram.com/${username}/`;

    const userAgent = USER_AGENTS[0];
    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });

    if (response.status === 404) {
      throw new Error(`Account "@${username}" not found (HTTP 404).`);
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch Instagram profile for "@${username}" (HTTP ${response.status}).`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Validate if the page returned a valid Instagram user profile
    const pageTitle = $('title').first().text().trim();
    if (!pageTitle || pageTitle === 'Instagram' || pageTitle.includes('Page Not Found')) {
      throw new Error(`Account "@${username}" does not exist or is suspended.`);
    }

    // 1. Check for Embedded JSON blocks (Relay/Polaris xig_user_by_igid_v2)
    const rawUserData = this.extractUserFromScriptJson($);

    // 2. Parse Meta Tags for fallback and additional counts
    const metaDesc = $('meta[name="description"]').attr('content') || 
                     $('meta[property="og:description"]').attr('content') || '';
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';

    const metaParsed = this.parseMetaDescription(metaDesc);

    // 3. Synthesize & prioritize high-fidelity fields
    const fullName = rawUserData?.full_name || metaParsed.fullName || ogTitle.split('•')[0]?.replace(/\(@[^\)]+\)/, '').trim() || username;
    const pk = rawUserData?.pk ? String(rawUserData.pk) : null;
    const metaId = rawUserData?.id ? String(rawUserData.id) : null;
    const biography = rawUserData?.biography !== undefined ? rawUserData.biography : (metaParsed.bio || '');
    const isVerified = rawUserData?.is_verified ?? (pageTitle.includes('Verified') || html.includes('Verified'));
    const isPrivate = rawUserData?.is_private ?? (html.includes('This profile is private') || html.includes('This Account is Private'));
    
    // Followers & Following count (Prefer exact count from JSON, fallback to meta tag)
    const followersCount = rawUserData?.follower_count ?? parseCompactNumber(metaParsed.followersStr);
    const followingCount = rawUserData?.following_count ?? parseCompactNumber(metaParsed.followingStr);
    const postsCount = parseCompactNumber(metaParsed.postsStr);

    const profilePicUrl = rawUserData?.profile_pic_url || ogImage || null;
    const hasAnyClips = Boolean(rawUserData?.has_any_clips);
    const latestReelTimestamp = rawUserData?.latest_reel_media ? Number(rawUserData.latest_reel_media) : null;

    // Determine account classification
    let accountType: AccountType = 'PUBLIC_PERSONAL';
    if (isPrivate) {
      accountType = 'PRIVATE';
    } else if (hasAnyClips || latestReelTimestamp || rawUserData?.category_name || (followersCount > 10000 && isVerified)) {
      accountType = 'BUSINESS_OR_CREATOR';
    }

    // 4. Extract recent media from DOM (if public)
    const recentPosts: InstagramPost[] = [];
    if (!isPrivate) {
      $('img').each((_, el) => {
        const alt = $(el).attr('alt') || '';
        const src = $(el).attr('src') || '';

        // Filter out profile pictures, icons, and empty images
        if (src && alt && !alt.toLowerCase().includes('profile picture') && !alt.toLowerCase().includes('logo')) {
          const shortcode = extractShortcodeFromImageUrl(src);
          if (shortcode) {
            recentPosts.push({
              shortcode,
              permalink: `https://www.instagram.com/p/${shortcode}/`,
              caption: this.decodeHtmlEntities(alt),
              imageUrl: src,
            });
          }
        }
      });
    }

    // 5. Optional Deep Enrichment for Recent Posts (Likes, Comments, Timestamps)
    if (options.includeDeepPostMetrics && recentPosts.length > 0) {
      const postsToEnrich = recentPosts.slice(0, options.maxDeepPosts || 6);
      await Promise.all(
        postsToEnrich.map(async (post) => {
          try {
            await this.enrichPostMetrics(post);
          } catch {
            // Silently continue if single post enrichment fails
          }
        })
      );
    }

    return {
      username,
      fullName: this.decodeHtmlEntities(fullName),
      pk,
      metaId,
      biography: this.decodeHtmlEntities(biography),
      followersCount,
      followingCount,
      postsCount,
      isVerified,
      isPrivate,
      isBusinessAccount: accountType === 'BUSINESS_OR_CREATOR',
      accountType,
      profilePicUrl,
      hasAnyClips,
      latestReelTimestamp,
      recentPosts,
      fetchedAt: new Date().toISOString(),
      dataSource: 'web_scraper',
    };
  }

  /**
   * Enriches a single post with exact likes, comments, and timestamp from its permalink
   */
  async enrichPostMetrics(post: InstagramPost): Promise<void> {
    const response = await fetch(post.permalink, {
      headers: {
        'User-Agent': USER_AGENTS[0],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) return;

    const html = await response.text();
    const $ = cheerio.load(html);
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';

    // Example og:description:
    // "564K likes, 181K comments - zuck on October 12, 2026: \"...\""
    const match = ogDesc.match(/^([\d.,]+[KMB]?)\s+likes?,\s+([\d.,]+[KMB]?)\s+comments?\s+-\s+.*?\s+on\s+([^:]+):/i);
    if (match) {
      post.likesCount = parseCompactNumber(match[1]);
      post.commentsCount = parseCompactNumber(match[2]);
      post.postedAt = match[3].trim();
    }
  }

  /**
   * Finds the structured user object in script type="application/json" tags
   */
  private extractUserFromScriptJson($: cheerio.CheerioAPI): any | null {
    let extractedUser: any = null;

    $('script[type="application/json"]').each((_, el) => {
      if (extractedUser) return;
      const content = $(el).html();
      if (!content || (!content.includes('xig_user_by_igid_v2') && !content.includes('follower_count'))) return;

      try {
        const json = JSON.parse(content);
        const findUser = (obj: any): any => {
          if (!obj || typeof obj !== 'object') return null;
          if (obj.xig_user_by_igid_v2 && typeof obj.xig_user_by_igid_v2 === 'object') {
            return obj.xig_user_by_igid_v2;
          }
          if (obj.user && typeof obj.user === 'object' && obj.user.follower_count !== undefined) {
            return obj.user;
          }
          if (Array.isArray(obj)) {
            for (const item of obj) {
              const res = findUser(item);
              if (res) return res;
            }
          } else {
            for (const key of Object.keys(obj)) {
              const res = findUser(obj[key]);
              if (res) return res;
            }
          }
          return null;
        };

        const result = findUser(json);
        if (result) {
          extractedUser = result;
        }
      } catch {
        // Continue searching other scripts if JSON.parse fails
      }
    });

    return extractedUser;
  }

  /**
   * Parses standard Instagram meta description format:
   * "{followers} Followers, {following} Following, {posts} Posts - {FullName} (@{username}) on Instagram: \"{bio}\""
   */
  private parseMetaDescription(meta: string) {
    const unescaped = this.decodeHtmlEntities(meta);
    const regex = /([\d.,]+[KMB]?)\s+Followers,\s+([\d.,]+[KMB]?)\s+Following,\s+([\d.,]+[KMB]?)\s+Posts\s+-\s+(.*?)\s+\(@([^\)]+)\)\s+on\s+Instagram:\s*\"?(.*?)\"?$/i;
    const match = unescaped.match(regex);

    if (match) {
      return {
        followersStr: match[1],
        followingStr: match[2],
        postsStr: match[3],
        fullName: match[4]?.trim(),
        username: match[5]?.trim(),
        bio: match[6]?.trim(),
      };
    }

    return {
      followersStr: '0',
      followingStr: '0',
      postsStr: '0',
      fullName: '',
      username: '',
      bio: '',
    };
  }

  private decodeHtmlEntities(str: string): string {
    return str
      .replace(/&#064;/g, '@')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#x2022;/g, '•');
  }
}
