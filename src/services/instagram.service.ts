import dotenv from 'dotenv';
import { InstagramWebScraper } from '../scrapers/instagram-web.scraper.js';
import { InstagramProfile, ScrapeOptions } from '../types/instagram.js';

dotenv.config();

export class InstagramService {
  private webScraper: InstagramWebScraper;

  constructor() {
    this.webScraper = new InstagramWebScraper();
  }

  /**
   * Fetches metadata for any Instagram username
   * @param username The Instagram username (with or without @)
   * @param options Scraping options
   */
  async getUser(username: string, options: ScrapeOptions = {}): Promise<InstagramProfile> {
    const cleanUsername = username.trim().toLowerCase().replace(/^@/, '');
    return await this.webScraper.scrapeProfile(cleanUsername, options);
  }
}
