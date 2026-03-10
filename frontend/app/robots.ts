import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: ['/admin', '/api/'], // Protect admin and backend proxy paths
        },
        sitemap: 'https://pitchy.pro/sitemap.xml',
    };
}
