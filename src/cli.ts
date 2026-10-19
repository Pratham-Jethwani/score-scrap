#!/usr/bin/env node
import { InstagramService } from './services/instagram.service.js';

async function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((arg) => arg.startsWith('--'));
  const positional = args.filter((arg) => !arg.startsWith('--'));

  const username = positional[0];
  const isDeep = flags.includes('--deep');
  const isJson = flags.includes('--json');

  if (!username) {
    console.log(`
Usage:
  npm run scrape <username> [options]

Options:
  --deep     Fetch exact likes, comments, and post dates for recent posts
  --json     Output raw JSON only

Examples:
  npm run scrape zuck
  npm run scrape zuck --deep
  npm run scrape privatetest
  npm run scrape nike --json
`);
    process.exit(1);
  }

  const service = new InstagramService();

  if (!isJson) {
    console.log(`\n🔍 Fetching metadata for Instagram user: @${username}...`);
    if (isDeep) {
      console.log(`⚡ Deep post metrics enabled (retrieving likes, comments, and post timestamps)...`);
    }
  }

  try {
    const profile = await service.getUser(username, {
      includeDeepPostMetrics: isDeep,
      maxDeepPosts: 6,
    });

    if (isJson) {
      console.log(JSON.stringify(profile, null, 2));
      return;
    }

    console.log(`\n======================================================`);
    console.log(`📸 INSTAGRAM PROFILE METADATA: @${profile.username}`);
    console.log(`======================================================`);
    console.log(`👤 Full Name:         ${profile.fullName}`);
    console.log(`🆔 Instagram PK / ID:  ${profile.pk || 'N/A'}`);
    console.log(`🌐 Meta ID:           ${profile.metaId || 'N/A'}`);
    console.log(`🏷️  Account Type:      ${profile.accountType}`);
    console.log(`🔒 Is Private:        ${profile.isPrivate ? 'YES' : 'NO'}`);
    console.log(`✅ Is Verified:       ${profile.isVerified ? 'YES' : 'NO'}`);
    console.log(`📊 Followers:         ${profile.followersCount.toLocaleString()}`);
    console.log(`👥 Following:         ${profile.followingCount.toLocaleString()}`);
    console.log(`🖼️  Total Posts:       ${profile.postsCount.toLocaleString()}`);
    console.log(`📝 Biography:         ${profile.biography ? `"${profile.biography}"` : '(Empty)'}`);
    console.log(`🖼️  Profile Picture:   ${profile.profilePicUrl || 'None'}`);
    console.log(`------------------------------------------------------`);
    console.log(`📌 Extracted Posts:    ${profile.recentPosts.length} posts found`);

    if (profile.recentPosts.length > 0) {
      console.log(`\n--- Recent Media Sample ---`);
      profile.recentPosts.slice(0, 5).forEach((post, index) => {
        console.log(`\n[Post ${index + 1}] Shortcode: ${post.shortcode}`);
        console.log(`🔗 URL:     ${post.permalink}`);
        if (post.likesCount !== undefined && post.likesCount !== null) {
          console.log(`❤️  Likes:   ${post.likesCount.toLocaleString()} | 💬 Comments: ${post.commentsCount?.toLocaleString() || 0}`);
        }
        if (post.postedAt) {
          console.log(`📅 Date:    ${post.postedAt}`);
        }
        if (post.caption) {
          const preview = post.caption.length > 90 ? post.caption.slice(0, 87) + '...' : post.caption;
          console.log(`💬 Caption: "${preview}"`);
        }
      });
    }

    console.log(`\n======================================================\n`);
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
