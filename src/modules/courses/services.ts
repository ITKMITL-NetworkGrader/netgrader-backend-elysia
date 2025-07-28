import { ObjectId } from 'mongodb';

function objectIdToShortcode(id: string | ObjectId): string {
    return Buffer.from(new ObjectId(id).id)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function shortcodeToObjectId(shortcode: string): ObjectId {
    let base64 = shortcode.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return new ObjectId(Buffer.from(base64, 'base64'));
}

export { objectIdToShortcode, shortcodeToObjectId };