/**
 * Test API directly to see where timeout occurs
 */

async function testEndpoint(url, label) {
  console.log(`\n🔍 Testing: ${label}`);
  console.log(`URL: ${url}`);
  console.log('━'.repeat(60));

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`⏱️  Aborting after 20 seconds...`);
      controller.abort();
    }, 20000);

    const response = await fetch(url, { signal: controller.signal });

    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    const data = await response.json();

    console.log(`✅ Response received in ${duration}ms`);
    console.log('Response:', JSON.stringify(data, null, 2).substring(0, 500));

    return { success: true, duration, data };
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error.name === 'AbortError') {
      console.log(`❌ TIMED OUT after ${duration}ms`);
      return { success: false, duration, timeout: true };
    }

    console.log(`❌ Error after ${duration}ms: ${error.message}`);
    return { success: false, duration, error: error.message };
  }
}

async function run() {
  console.log('Testing API endpoints directly...\n');

  // Test the search endpoint
  await testEndpoint(
    'http://localhost:3000/api/search?q=nile%20rogers',
    'Search API - "nile rogers"'
  );

  await new Promise(r => setTimeout(r, 2000));

  await testEndpoint(
    'http://localhost:3000/api/search?q=nile%20rodgers',
    'Search API - "nile rodgers"'
  );

  console.log('\n✨ Done!');
}

run().catch(console.error);
