const fs = require('fs');
const path = require('path');

const stylePath = path.join(__dirname, 'public/style.css');

try {
    // Read as buffer
    let buffer = fs.readFileSync(stylePath);

    // Convert to string. If mixed encoding, this might look weird.
    // We suspect Null bytes (\x00) from UTF-16LE characters.
    let content = buffer.toString('binary');

    // Filter out null bytes
    let cleanContent = content.replace(/\x00/g, '');

    console.log('Detected length:', buffer.length);
    console.log('Cleaned length:', cleanContent.length);

    // Write back as UTF-8
    fs.writeFileSync(stylePath, cleanContent, 'utf8');
    console.log('Fixed style.css encoding.');
} catch (err) {
    console.error('Error fixing style.css:', err);
}
