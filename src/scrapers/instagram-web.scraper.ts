import * as cheerio from 'cheerio';
import { InstagramProfile, InstagramPost, ScrapeOptions, AccountType } from '../types/instagram.js';
import { extractShortcodeFromImageUrl, parseCompactNumber } from '../utils/shortcode.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
];

export class InstagramWebScraper {
  /**
   * Main method to scrape public metadata for an Instagram user
   */
  async scrapeProfile(rawUsername: string, options: ScrapeOptions = {}): Promise<InstagramProfile> {
    const username = rawUsername.trim().toLowerCase().replace(/^@/, '');
    const url = `https://www.instagram.com/${username}/`;

    let html = '';
    let status = 0;

    const sessionId = process.env.INSTAGRAM_SESSION_ID || '';
    const customCookie = sessionId ? (sessionId.includes('sessionid=') ? sessionId : `sessionid=${sessionId}`) : '';

    // Try fetching profile with browser user agents
    for (const ua of USER_AGENTS) {
      try {
        const headers: Record<string, string> = {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Sec-Fetch-Mode': 'navigate',
        };
        if (customCookie) {
          headers['Cookie'] = customCookie;
        }

        const response = await fetch(url, { headers });
        status = response.status;
        if (response.status === 404) {
          throw new Error(`Account "@${username}" not found (HTTP 404).`);
        }
        if (response.ok) {
          const bodyText = await response.text();
          // Skip if Instagram served a redirect to the login page
          const titleMatch = bodyText.match(/<title>(.*?)<\/title>/i);
          const pageTitle = titleMatch ? titleMatch[1].trim() : '';
          if (pageTitle.toLowerCase().includes('login • instagram') || bodyText.includes('/accounts/login/')) {
            continue;
          }

          html = bodyText;
          if (html.includes('follower') || html.includes('biography') || html.includes('og:title')) {
            break;
          }
        }
      } catch (err: any) {
        if (err.message?.includes('404')) throw err;
      }
    }

    const $ = cheerio.load(html || '<html><head></head><body></body></html>');

    // 1. Check for Embedded JSON blocks (Relay/Polaris xig_user_by_igid_v2)
    const rawUserData = this.extractUserFromScriptJson($);

    // 2. Parse Meta Tags for fallback and additional counts
    const metaDesc = $('meta[name="description"]').attr('content') || 
                     $('meta[property="og:description"]').attr('content') || '';
    const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').text() || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';

    const metaParsed = this.parseMetaDescription(metaDesc);

    // 3. Synthesize fields from main profile
    const titleCandidate = (ogTitle.toLowerCase().includes('login') || ogTitle === 'Instagram') 
      ? '' 
      : ogTitle.split('•')[0]?.replace(/\(@[^\)]+\)/, '').trim();
    let fullName = rawUserData?.full_name || metaParsed.fullName || titleCandidate || username;
    let pk = rawUserData?.pk ? String(rawUserData.pk) : null;
    let metaId = rawUserData?.id ? String(rawUserData.id) : null;
    let biography = rawUserData?.biography !== undefined ? rawUserData.biography : (metaParsed.bio || '');
    let isVerified = rawUserData?.is_verified ?? (ogTitle.includes('Verified') || html.includes('Verified'));
    let isPrivate = rawUserData?.is_private ?? (html.includes('This profile is private') || html.includes('This Account is Private'));
    
    let followersCount = rawUserData?.follower_count ?? parseCompactNumber(metaParsed.followersStr);
    let followingCount = rawUserData?.following_count ?? parseCompactNumber(metaParsed.followingStr);
    let postsCount = parseCompactNumber(metaParsed.postsStr);

    let profilePicUrl = rawUserData?.profile_pic_url || ogImage || null;
    if (profilePicUrl && (profilePicUrl.includes('rzWiSjZRxk5') || profilePicUrl.includes('static.cdninstagram.com/rsrc.php'))) {
      profilePicUrl = null;
    }
    const hasAnyClips = Boolean(rawUserData?.has_any_clips);
    const latestReelTimestamp = rawUserData?.latest_reel_media ? Number(rawUserData.latest_reel_media) : null;

    // 4. Extract recent media from DOM (if public)
    const recentPosts: InstagramPost[] = [];
    if (!isPrivate) {
      $('img').each((_, el) => {
        const alt = $(el).attr('alt') || '';
        const src = $(el).attr('src') || '';

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

    // 5. Cloud-Proof Fallback (Embed API): If main profile returned zeroed metrics on cloud/Netlify IPs
    if (followersCount === 0 || recentPosts.length === 0) {
      const embedData = await this.fetchEmbedFallback(username);
      if (embedData) {
        if (followersCount === 0 && embedData.followersCount > 0) {
          followersCount = embedData.followersCount;
        }
        if (postsCount === 0 && embedData.postsCount > 0) {
          postsCount = embedData.postsCount;
        }
        if (embedData.isVerified) isVerified = true;
        if (embedData.isPrivate) isPrivate = true;
        if (fullName === username && embedData.fullName) {
          fullName = embedData.fullName;
        }
        if (!profilePicUrl && embedData.profilePicUrl) {
          profilePicUrl = embedData.profilePicUrl;
        }

        // Add posts extracted from embed if none found on main profile
        if (recentPosts.length === 0 && embedData.shortcodes.length > 0) {
          embedData.shortcodes.slice(0, 12).forEach((sc) => {
            recentPosts.push({
              shortcode: sc,
              permalink: `https://www.instagram.com/p/${sc}/`,
              imageUrl: `https://www.instagram.com/p/${sc}/media/?size=m`,
              caption: `Post #${sc}`,
            });
          });
        }
      }
    }

    if (followersCount === 0 && postsCount === 0 && !isPrivate && !biography && recentPosts.length === 0) {
      throw new Error(
        `Instagram blocked this cloud IP with a login wall. Please add an INSTAGRAM_SESSION_ID in Netlify Site Settings > Environment Variables, or run the app locally.`
      );
    }

    // Determine account classification
    let accountType: AccountType = 'PUBLIC_PERSONAL';
    if (isPrivate) {
      accountType = 'PRIVATE';
    } else if (hasAnyClips || latestReelTimestamp || rawUserData?.category_name || (followersCount > 10000 && isVerified)) {
      accountType = 'BUSINESS_OR_CREATOR';
    }

    // Optional Deep Enrichment for Recent Posts
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
   * Fetches metadata from Instagram's public embed endpoint (bulletproof on cloud/datacenter IPs)
   */
  private async fetchEmbedFallback(username: string): Promise<{
    followersCount: number;
    postsCount: number;
    isVerified: boolean;
    isPrivate: boolean;
    fullName?: string;
    profilePicUrl?: string;
    shortcodes: string[];
  } | null> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      };
      const sessionId = process.env.INSTAGRAM_SESSION_ID || '';
      if (sessionId) {
        headers['Cookie'] = sessionId.includes('sessionid=') ? sessionId : `sessionid=${sessionId}`;
      }

      const res = await fetch(`https://www.instagram.com/${username}/embed/`, { headers });

      if (!res.ok) return null;
      const html = await res.text();

      const fMatch = html.match(/followers_count[\\"]*:\s*(\d+)/);
      const pMatch = html.match(/posts_count[\\"]*:\s*(\d+)/);
      const isVerifiedMatch = html.match(/is_verified[\\"]*:\s*(true|false)/);
      const isPrivateMatch = html.match(/is_private[\\"]*:\s*(true|false)/);
      const fnMatch = html.match(/full_name[\\"]*:\s*[\\"]*([^\\"]+)/);
      const picMatch = html.match(/(https:[^\\\"']+(?:cdninstagram|fbcdn)[^\\\"']+)/);

      const shortcodes: string[] = [];
      const scRegex = /shortcode[\\"]*:\s*[\\"]*([A-Za-z0-9_-]{10,12})/g;
      let m;
      while ((m = scRegex.exec(html)) !== null) {
        if (!shortcodes.includes(m[1])) {
          shortcodes.push(m[1]);
        }
      }

      return {
        followersCount: fMatch ? parseInt(fMatch[1], 10) : 0,
        postsCount: pMatch ? parseInt(pMatch[1], 10) : 0,
        isVerified: isVerifiedMatch ? isVerifiedMatch[1] === 'true' : false,
        isPrivate: isPrivateMatch ? isPrivateMatch[1] === 'true' : false,
        fullName: fnMatch ? this.decodeHtmlEntities(fnMatch[1]) : undefined,
        profilePicUrl: picMatch ? picMatch[1].replace(/\\/g, '') : undefined,
        shortcodes,
      };
    } catch {
      return null;
    }
  }

  /**
   * Enriches a single post with exact likes, comments, and timestamp from its permalink
   */
  async enrichPostMetrics(post: InstagramPost): Promise<void> {
    const response = await fetch(post.permalink, {
      headers: {
        'User-Agent': USER_AGENTS[1],
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

    // Extract numbers independently to prevent broken regex matching
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
