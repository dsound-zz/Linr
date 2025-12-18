/**
 * Test script to debug "nile rogers" search timeout
 */

async function testSearch(query) {
  console.log(`\n🔍 Testing: "${query}"`);
  console.log('━'.repeat(60));

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`⏱️  Aborting after 20 seconds...`);
      controller.abort();
    }, 20000);

    const response = await fetch(
      `http://localhost:3000/api/search?q=${encodeURIComponent(query)}`,
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      console.log(`❌ Failed after ${duration}ms`);
      console.log(`Error: ${error}`);
      return { query, duration, success: false, error };
    }

    const data = await response.json();
    const resultCount = data.results?.length || 0;

    console.log(`✅ Success! Duration: ${duration}ms`);
    console.log(`Intent: ${data.intent}`);
    console.log(`Mode: ${data.mode}`);
    console.log(`Results: ${resultCount}`);

    if (data.results && data.results.length > 0) {
      console.log('\nTop results:');
      data.results.slice(0, 3).forEach((r, i) => {
        if (data.intent === 'contributor') {
          console.log(`  ${i+1}. ${r.artistName} (${r.artistMBID})`);
          if (r.primaryRoles) console.log(`     Roles: ${r.primaryRoles.join(', ')}`);
        } else {
          console.log(`  ${i+1}. ${r.title} - ${r.artist}`);
        }
      });
    }

    return { query, duration, success: true, intent: data.intent, resultCount, data };
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error.name === 'AbortError') {
      console.log(`❌ TIMED OUT after ${duration}ms`);
      return { query, duration, success: false, timeout: true };
    }

    console.log(`❌ Error after ${duration}ms: ${error.message}`);
    return { query, duration, success: false, error: error.message };
  }
}

async function runTests() {
  console.log('🧪 Testing "nile rogers" search timeout issue...\n');
  console.log('Make sure dev server is running on http://localhost:3000\n');

  const queries = [
    'nile rogers',      // Misspelling (missing 'd')
    'nile rodgers',     // Correct spelling
    'Nile Rodgers',     // With capitals
  ];

  for (const query of queries) {
    await testSearch(query);
    // Wait between queries to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n✨ Tests complete!');
}

runTests().catch(console.error);
