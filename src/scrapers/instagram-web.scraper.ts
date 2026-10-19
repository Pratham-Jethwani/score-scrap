import * as cheerio from 'cheerio';
import { InstagramProfile, InstagramPost, ScrapeOptions, AccountType } from '../types/instagram.js';
import { extractShortcodeFromImageUrl, parseCompactNumber } from '../utils/shortcode.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

export class InstagramWebScraper {
  /**
   * Main method to scrape public metadata for an Instagram user
   */
  async scrapeProfile(rawUsername: string, options: ScrapeOptions = {}): Promise<InstagramProfile> {
    const username = rawUsername.trim().toLowerCase().replace(/^@/, '');
    const url = `https://www.instagram.com/${username}/`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
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
    const ogTitle = $('meta[property="og:title"]').attr('content') || pageTitle || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';

    const metaParsed = this.parseMetaDescription(metaDesc);

    // 3. Synthesize fields
    const titleCandidate = (ogTitle.toLowerCase().includes('login') || ogTitle === 'Instagram')
      ? ''
      : ogTitle.split('•')[0]?.replace(/\(@[^\)]+\)/, '').trim();

    const fullName = rawUserData?.full_name || metaParsed.fullName || titleCandidate || username;
    const pk = rawUserData?.pk ? String(rawUserData.pk) : null;
    const metaId = rawUserData?.id ? String(rawUserData.id) : null;
    const biography = rawUserData?.biography !== undefined ? rawUserData.biography : (metaParsed.bio || '');
    const isVerified = rawUserData?.is_verified ?? (ogTitle.includes('Verified') || html.includes('Verified'));
    const isPrivate = rawUserData?.is_private ?? (html.includes('This profile is private') || html.includes('This Account is Private'));
    
    // Followers & Following count (Prefer exact count from JSON, fallback to meta tag)
    const followersCount = rawUserData?.follower_count ?? parseCompactNumber(metaParsed.followersStr);
    const followingCount = rawUserData?.following_count ?? parseCompactNumber(metaParsed.followingStr);
    const postsCount = parseCompactNumber(metaParsed.postsStr);

    let profilePicUrl = rawUserData?.profile_pic_url || ogImage || null;
    if (profilePicUrl && (profilePicUrl.includes('rzWiSjZRxk5') || profilePicUrl.includes('static.cdninstagram.com/rsrc.php'))) {
      profilePicUrl = null;
    }

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
          if (shortcode && !recentPosts.some(p => p.shortcode === shortcode)) {
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

    // 5. Optional Deep Enrichment for Recent Posts
    if (options.includeDeepPostMetrics && recentPosts.length > 0) {
      const postsToEnrich = recentPosts.slice(0, options.maxDeepPosts || 6);
      await Promise.all(
        postsToEnrich.map(async (post) => {
          try {
            await this.enrichPostMetrics(post);
          } catch {
            // Silently continue
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
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) return;

    const html = await response.text();
    const $ = cheerio.load(html);
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';

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
        // Continue searching
      }
    });

    return extractedUser;
  }

  /**
   * Parses standard Instagram meta description format independently
   */
  private parseMetaDescription(meta: string) {
    const unescaped = this.decodeHtmlEntities(meta);

    // Extract numbers independently
    const followersMatch = unescaped.match(/([\d.,]+[KMB]?)\s+Followers/i);
    const followingMatch = unescaped.match(/([\d.,]+[KMB]?)\s+Following/i);
    const postsMatch = unescaped.match(/([\d.,]+[KMB]?)\s+Posts/i);

    // Extract name and bio
    let fullName = '';
    let bio = '';

    const bioSplit = unescaped.split(/on Instagram:\s*"/i);
    if (bioSplit.length > 1) {
      bio = bioSplit[1].replace(/"$/, '').trim();
      const namePart = bioSplit[0].split('-').pop() || '';
      fullName = namePart.replace(/\(@[^\)]+\)/, '').trim();
    } else {
      const seePhotos = unescaped.split(/from\s+/i);
      if (seePhotos.length > 1) {
        fullName = seePhotos[1].replace(/\(@[^\)]+\)/, '').trim();
      }
    }

    return {
      followersStr: followersMatch ? followersMatch[1] : '0',
      followingStr: followingMatch ? followingMatch[1] : '0',
      postsStr: postsMatch ? postsMatch[1] : '0',
      fullName,
      username: '',
      bio,
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
