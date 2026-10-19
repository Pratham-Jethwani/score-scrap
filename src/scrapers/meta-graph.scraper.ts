import { InstagramProfile, InstagramPost, AccountType } from '../types/instagram.js';

export interface MetaGraphConfig {
  accessToken: string;
  instagramAccountId: string;
  apiVersion?: string;
}

export class MetaGraphScraper {
  private config: MetaGraphConfig;

  constructor(config: MetaGraphConfig) {
    this.config = {
      apiVersion: 'v26.0',
      ...config,
    };
  }

  /**
   * Queries Meta's official Business Discovery API for a Business/Creator username
   */
  async scrapeProfile(rawUsername: string): Promise<InstagramProfile> {
    const username = rawUsername.trim().toLowerCase().replace(/^@/, '');
    const { accessToken, instagramAccountId, apiVersion } = this.config;

    const fields = [
      'username',
      'name',
      'id',
      'ig_id',
      'biography',
      'website',
      'followers_count',
      'follows_count',
      'media_count',
      'profile_picture_url',
      'media{id,caption,like_count,comments_count,media_type,permalink,timestamp}'
    ].join(',');

    const url = `https://graph.facebook.com/${apiVersion}/${instagramAccountId}?fields=business_discovery.username(${username}){${fields}}&access_token=${encodeURIComponent(accessToken)}`;

    const response = await fetch(url);
    const json = (await response.json()) as any;

    if (json.error) {
      throw new Error(`Meta Graph API Error [${json.error.code}]: ${json.error.message}`);
    }

    const data = json.business_discovery;
    if (!data) {
      throw new Error(`No business discovery data found for @${username}`);
    }

    const recentPosts: InstagramPost[] = (data.media?.data || []).map((m: any) => ({
      id: m.id,
      shortcode: m.permalink ? m.permalink.split('/p/')[1]?.replace('/', '') || '' : '',
      permalink: m.permalink || '',
      caption: m.caption || null,
      likesCount: m.like_count ?? null,
      commentsCount: m.comments_count ?? null,
      postedAt: m.timestamp || null,
      isVideo: m.media_type === 'VIDEO',
    }));

    return {
      username: data.username || username,
      fullName: data.name || '',
      pk: data.ig_id ? String(data.ig_id) : null,
      metaId: data.id ? String(data.id) : null,
      biography: data.biography || '',
      externalUrl: data.website || null,
      followersCount: data.followers_count || 0,
      followingCount: data.follows_count || 0,
      postsCount: data.media_count || 0,
      isVerified: true, // Accounts accessible via business discovery are registered professional
      isPrivate: false,
      isBusinessAccount: true,
      accountType: 'BUSINESS_OR_CREATOR' as AccountType,
      profilePicUrl: data.profile_picture_url || null,
      hasAnyClips: true,
      recentPosts,
      fetchedAt: new Date().toISOString(),
      dataSource: 'meta_graph_api',
    };
  }
}
