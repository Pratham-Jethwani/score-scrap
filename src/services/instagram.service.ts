import dotenv from 'dotenv';
import { InstagramWebScraper } from '../scrapers/instagram-web.scraper.js';
import { MetaGraphScraper } from '../scrapers/meta-graph.scraper.js';
import { InstagramProfile, ScrapeOptions } from '../types/instagram.js';

dotenv.config();

export class InstagramService {
  private webScraper: InstagramWebScraper;
  private metaGraphScraper: MetaGraphScraper | null = null;

  constructor() {
    this.webScraper = new InstagramWebScraper();

    // Check if Meta Graph credentials are provided in environment
    const accessToken = process.env.META_ACCESS_TOKEN;
    const instagramAccountId = process.env.META_INSTAGRAM_ACCOUNT_ID;

    if (accessToken && instagramAccountId) {
      this.metaGraphScraper = new MetaGraphScraper({
        accessToken,
        instagramAccountId,
      });
    }
  }

  /**
   * Fetches metadata for any Instagram username
   * @param username The Instagram username (with or without @)
   * @param options Scraping options
   */
  async getUser(username: string, options: ScrapeOptions = {}): Promise<InstagramProfile> {
    const cleanUsername = username.trim().toLowerCase().replace(/^@/, '');

    // Web scraper handles personal, private, and business accounts seamlessly
    return await this.webScraper.scrapeProfile(cleanUsername, options);
  }

  /**
   * Fetches metadata using official Meta Graph API (requires Business/Creator account & configured token)
   */
  async getViaMetaGraph(username: string): Promise<InstagramProfile> {
    if (!this.metaGraphScraper) {
      throw new Error(
        'Meta Graph API is not configured. Please set META_ACCESS_TOKEN and META_INSTAGRAM_ACCOUNT_ID in your .env file.'
      );
    }
    return await this.metaGraphScraper.scrapeProfile(username);
  }
}
