import { User } from '../auth/model.js';
import { storageService } from '../../services/storage.js';

/**
 * Profile Service
 * Handles profile-related operations
 */
export class ProfileService {
    /**
     * Get user profile by user ID
     * Returns profile data with presigned URL for profile picture
     */
    static async getProfile(userId: string) {
        const user = await User.findOne(
            { u_id: userId },
            { u_id: 1, fullName: 1, role: 1, profilePicture: 1, bio: 1, createdAt: 1, lastLogin: 1 }
        );

        if (!user) {
            return null;
        }

        // Generate presigned URL for profile picture if exists
        let profilePictureUrl: string | null = null;
        if (user.profilePicture) {
            try {
                profilePictureUrl = await storageService.getPresignedUrl(user.profilePicture);
            } catch (error) {
                console.error('Error generating presigned URL for profile picture:', error);
            }
        }

        return {
            u_id: user.u_id,
            fullName: user.fullName,
            role: user.role,
            profilePicture: profilePictureUrl,
            bio: user.bio || '',
            createdAt: user.createdAt,
            lastLogin: user.lastLogin,
        };
    }

    /**
     * Update user bio
     */
    static async updateBio(userId: string, bio: string): Promise<{ success: boolean; message: string; bio?: string }> {
        // Validate bio length
        if (bio.length > 500) {
            return { success: false, message: 'Bio must be 500 characters or less' };
        }

        const result = await User.findOneAndUpdate(
            { u_id: userId },
            { bio: bio.trim() },
            { new: true }
        );

        if (!result) {
            return { success: false, message: 'User not found' };
        }

        return { success: true, message: 'Bio updated successfully', bio: result.bio };
    }

    /**
     * Get public profile (for viewing other users)
     * Returns limited information
     */
    static async getPublicProfile(userId: string) {
        const user = await User.findOne(
            { u_id: userId },
            { u_id: 1, fullName: 1, role: 1, profilePicture: 1, bio: 1, createdAt: 1 }
        );

        if (!user) {
            return null;
        }

        // Generate presigned URL for profile picture if exists
        let profilePictureUrl: string | null = null;
        if (user.profilePicture) {
            try {
                profilePictureUrl = await storageService.getPresignedUrl(user.profilePicture);
            } catch (error) {
                console.error('Error generating presigned URL for profile picture:', error);
            }
        }

        return {
            u_id: user.u_id,
            fullName: user.fullName,
            role: user.role,
            profilePicture: profilePictureUrl,
            bio: user.bio || '',
            createdAt: user.createdAt,
        };
    }
}
