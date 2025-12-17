/**
 * Test script for contributor API alias handling
 * Tests the "/api/contributor" endpoint with various contributor names
 */

interface ContributorProfile {
  name: string;
  totalContributions: number;
  totalRecordings: number;
  hasMore: boolean;
  roleBreakdown: Array<{ role: string; count: number }>;
  contributions: Array<{
    recordingId: string;
    title: string;
    artist: string;
    releaseDate: string | null;
    roles: string[];
  }>;
}

async function testContributor(name: string): Promise<void> {
  console.log(`\n========================================`);
  console.log(`Testing contributor: ${name}`);
  console.log(`========================================`);

  try {
    const response = await fetch(`http://localhost:3000/api/contributor?name=${encodeURIComponent(name)}`);
    const data = (await response.json()) as ContributorProfile;

    console.log(`\nProfile for "${data.name}":`);
    console.log(`  Total Recordings: ${data.totalRecordings}`);
    console.log(`  Total Contributions: ${data.totalContributions}`);
    console.log(`  Has More: ${data.hasMore}`);

    if (data.roleBreakdown && data.roleBreakdown.length > 0) {
      console.log(`\n  Role Breakdown:`);
      for (const role of data.roleBreakdown) {
        console.log(`    - ${role.role}: ${role.count}`);
      }
    }

    if (data.contributions && data.contributions.length > 0) {
      console.log(`\n  First 3 Contributions:`);
      for (let i = 0; i < Math.min(3, data.contributions.length); i++) {
        const contrib = data.contributions[i];
        console.log(
          `    ${i + 1}. "${contrib.title}" (${contrib.artist}) - ${contrib.releaseDate || "Unknown date"}`
        );
        console.log(`       Roles: ${contrib.roles.join(", ")}`);
      }
    } else {
      console.log(`\n  No contributions found.`);
    }
  } catch (err) {
    console.error(`Error fetching contributor: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  // Test cases
  const testCases = [
    "Dr. Luke",     // Known alias: Łukasz Gottwald
    "Łukasz Gottwald",  // Primary name
    "Max Martin",   // Should have many producer credits
    "Sean Garrett", // Another producer
  ];

  for (const testCase of testCases) {
    await testContributor(testCase);
    // Add small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`\n========================================`);
  console.log(`Tests completed!`);
  console.log(`========================================`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
