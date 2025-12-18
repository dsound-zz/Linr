/**
 * Test the /api/intent-search endpoint specifically
 */

async function testIntentEndpoint(query) {
  console.log(`\n🔍 Testing intent-search: "${query}"`);
  console.log('━'.repeat(60));

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`⏱️  Aborting after 20 seconds...`);
      controller.abort();
    }, 20000);

    const url = `http://localhost:3000/api/intent-search?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { signal: controller.signal });

    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    const data = await response.json();

    console.log(`✅ Response received in ${duration}ms`);
    console.log(`Intent: ${data.intent}`);
    if (data.intent === 'contributor') {
      console.log(`Contributor: ${data.contributorName} (${data.contributorId})`);
    } else if (data.intent === 'recording') {
      console.log(`Recording ID: ${data.recordingId}`);
    } else if (data.intent === 'ambiguous') {
      console.log(`Recordings: ${data.recordings?.length || 0}`);
      console.log(`Contributors: ${data.contributors?.length || 0}`);
    }

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
  console.log('🧪 Testing /api/intent-search endpoint...\n');

  await testIntentEndpoint('nile rogers');
  await new Promise(r => setTimeout(r, 2000));

  await testIntentEndpoint('nile rodgers');
  await new Promise(r => setTimeout(r, 2000));

  await testIntentEndpoint('Nile Rodgers');

  console.log('\n✨ Done!');
}

run().catch(console.error);
