const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');

const inputPath = 'C:\\Users\\s4nya\\Downloads\\pitchy-main (1)\\pitchy-main\\frontend\\icons\\logotip.png';
const appDir = 'C:\\Users\\s4nya\\Downloads\\pitchy-main (1)\\pitchy-main\\frontend\\app';

async function generate() {
    try {
        console.log('Generating apple-icon.png (180x180)...');
        await sharp(inputPath)
            .resize(180, 180, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toFile(path.join(appDir, 'apple-icon.png'));

        console.log('Generating favicon.ico...');
        // Create an intermediate 32x32 png for the ico
        const tempPng = path.join(appDir, 'temp-32.png');
        await sharp(inputPath)
            .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toFile(tempPng);
        
        const buf = await pngToIco(tempPng);
        fs.writeFileSync(path.join(appDir, 'favicon.ico'), buf);
        
        fs.unlinkSync(tempPng);
        
        console.log('Successfully generated favicon.ico and apple-icon.png!');
    } catch(err) {
        console.error('Error:', err);
    }
}

generate();
