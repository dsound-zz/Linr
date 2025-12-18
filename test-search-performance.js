/**
 * Test script to measure search performance for popular artists
 * Run with: node test-search-performance.js
 */

const testQueries = [
  'nile rodgers',
  'max martin',
  'pharrell williams',
];

async function testSearch(query) {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(
      `http://localhost:3000/api/search?q=${encodeURIComponent(query)}`,
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      console.log(`❌ ${query}: Failed after ${duration}ms - ${error}`);
      return { query, duration, success: false, error };
    }

    const data = await response.json();
    const resultCount = data.results?.length || 0;

    console.log(`✅ ${query}: ${duration}ms - ${data.intent} - ${resultCount} results`);
    return { query, duration, success: true, intent: data.intent, resultCount };
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error.name === 'AbortError') {
      console.log(`⏱️  ${query}: Timed out after ${duration}ms`);
      return { query, duration, success: false, timeout: true };
    }

    console.log(`❌ ${query}: Error after ${duration}ms - ${error.message}`);
    return { query, duration, success: false, error: error.message };
  }
}

async function runTests() {
  console.log('🧪 Testing search performance...\n');
  console.log('Make sure the dev server is running on http://localhost:3000\n');

  const results = [];

  for (const query of testQueries) {
    const result = await testSearch(query);
    results.push(result);

    // Wait a bit between queries to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  console.log('\n📊 Summary:');
  console.log('━'.repeat(60));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const timedOut = results.filter(r => r.timeout);

  console.log(`Total queries: ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Timed out: ${timedOut.length}`);

  if (successful.length > 0) {
    const avgDuration = successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
    const maxDuration = Math.max(...successful.map(r => r.duration));
    const minDuration = Math.min(...successful.map(r => r.duration));

    console.log(`\nResponse times:`);
    console.log(`  Min: ${minDuration}ms`);
    console.log(`  Max: ${maxDuration}ms`);
    console.log(`  Avg: ${avgDuration.toFixed(0)}ms`);
  }
}

runTests().catch(console.error);
