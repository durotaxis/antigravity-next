const imageService = require('./image_service');

(async () => {
    console.log('--- Starting Image Import ---');
    try {
        const results = await imageService.importFromInbox();
        console.log('--- Import Complete ---');
        console.table(results);
    } catch (err) {
        console.error('Fatal Error:', err);
    }
})();
