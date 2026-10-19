export type AccountType = 
  | 'BUSINESS_OR_CREATOR' 
  | 'PUBLIC_PERSONAL' 
  | 'PRIVATE' 
  | 'NOT_FOUND';

export interface InstagramPost {
  id?: string;
  shortcode: string;
  permalink: string;
  caption?: string | null;
  imageUrl?: string | null;
  likesCount?: number | null;
  commentsCount?: number | null;
  postedAt?: string | null;
  isVideo?: boolean;
}

export interface InstagramProfile {
  username: string;
  fullName: string;
  pk: string | null;
  metaId: string | null;
  biography: string;
  externalUrl?: string | null;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  isVerified: boolean;
  isPrivate: boolean;
  isBusinessAccount: boolean;
  accountType: AccountType;
  profilePicUrl: string | null;
  hasAnyClips: boolean;
  latestReelTimestamp?: number | null;
  recentPosts: InstagramPost[];
  fetchedAt: string;
  dataSource: 'web_scraper';
}

export interface ScrapeOptions {
  includeDeepPostMetrics?: boolean;
  maxDeepPosts?: number;
}
