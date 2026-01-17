/**
 * Large Subnet Allocation Service
 * Handles student subnet allocation with collision resolution for large subnet mode
 * 
 * This service allocates unique subnets from a private network pool to each student.
 * When collisions occur (two students hash to same index), it uses +1 wraparound.
 */

import { Types } from 'mongoose';
import { StudentLabSession, IStudentLabSession } from '../student-lab-sessions/model';

// Type definitions
export interface LargeSubnetConfig {
    privateNetworkPool: '10.0.0.0/8' | '172.16.0.0/12' | '192.168.0.0/16';
    studentSubnetSize: number;  // e.g., 23 for /23
    subVlans: Array<{
        id: string;
        name: string;
        subnetSize: number;
        subnetIndex: number;
        vlanIdRandomized: boolean;
        fixedVlanId?: number;
    }>;
}

export interface AllocationResult {
    subnetIndex: number;
    subnetCIDR: string;       // e.g., "10.0.2.0/23"
    networkAddress: string;   // e.g., "10.0.2.0"
    randomizedVlanIds: number[];
}

interface PoolInfo {
    baseAddress: number;      // Numeric representation of base IP
    prefixLength: number;     // 8, 12, or 16
}

export class LargeSubnetAllocator {
    /**
     * Get pool information from pool string
     */
    private static getPoolInfo(pool: LargeSubnetConfig['privateNetworkPool']): PoolInfo {
        switch (pool) {
            case '10.0.0.0/8':
                return { baseAddress: 0x0A000000, prefixLength: 8 };  // 10.0.0.0
            case '172.16.0.0/12':
                return { baseAddress: 0xAC100000, prefixLength: 12 }; // 172.16.0.0
            case '192.168.0.0/16':
                return { baseAddress: 0xC0A80000, prefixLength: 16 }; // 192.168.0.0
            default:
                throw new Error(`Unknown private network pool: ${pool}`);
        }
    }

    /**
     * Calculate total available subnets in the pool
     */
    static getTotalSubnets(config: LargeSubnetConfig): number {
        const poolInfo = this.getPoolInfo(config.privateNetworkPool);
        // Number of subnets = 2^(studentSubnetSize - poolPrefixLength)
        return Math.pow(2, config.studentSubnetSize - poolInfo.prefixLength);
    }

    /**
     * Hash student ID to initial subnet index
     * Uses a deterministic hash for reproducibility
     * 
     * Algorithm:
     * 1. Parse student ID as number
     * 2. Multiply by prime (2654435761) for better distribution
     * 3. Take modulo of total subnets
     */
    static hashStudentId(studentId: string, totalSubnets: number): number {
        const id = parseInt(studentId, 10);
        if (isNaN(id)) {
            throw new Error(`Invalid student ID: ${studentId}`);
        }

        // Use Knuth's multiplicative hash with golden ratio prime
        // This provides good distribution across the hash space
        const hash = ((id * 2654435761) >>> 0) % totalSubnets;
        return hash;
    }

    /**
     * Calculate network address from pool and index
     */
    static calculateNetworkAddress(config: LargeSubnetConfig, subnetIndex: number): string {
        const poolInfo = this.getPoolInfo(config.privateNetworkPool);

        // Calculate subnet size in addresses
        const subnetSize = Math.pow(2, 32 - config.studentSubnetSize);

        // Calculate the network address
        const networkNum = poolInfo.baseAddress + (subnetIndex * subnetSize);

        // Convert to dotted decimal
        return [
            (networkNum >>> 24) & 0xFF,
            (networkNum >>> 16) & 0xFF,
            (networkNum >>> 8) & 0xFF,
            networkNum & 0xFF
        ].join('.');
    }

    /**
     * Calculate CIDR notation for the allocated subnet
     */
    static calculateSubnetCIDR(config: LargeSubnetConfig, subnetIndex: number): string {
        const networkAddress = this.calculateNetworkAddress(config, subnetIndex);
        return `${networkAddress}/${config.studentSubnetSize}`;
    }

    /**
     * Generate random VLAN IDs (2-4096, unique within set)
     */
    static generateRandomVlanIds(count: number): number[] {
        const ids: number[] = [];
        const usedIds = new Set<number>();

        for (let i = 0; i < count; i++) {
            let vlanId: number;
            let attempts = 0;
            const maxAttempts = 1000;

            do {
                // Random VLAN ID between 2 and 4094 (inclusive)
                vlanId = Math.floor(Math.random() * 4093) + 2;
                attempts++;

                if (attempts > maxAttempts) {
                    throw new Error('Failed to generate unique VLAN IDs');
                }
            } while (usedIds.has(vlanId));

            usedIds.add(vlanId);
            ids.push(vlanId);
        }

        return ids;
    }

    /**
     * Get all currently allocated subnet indices for a lab
     */
    static async getAllocatedIndices(labId: Types.ObjectId): Promise<Set<number>> {
        const activeSessions = await StudentLabSession.find({
            labId,
            status: 'active',
            'largeSubnetAllocation.allocatedSubnetIndex': { $exists: true }
        }).select('largeSubnetAllocation.allocatedSubnetIndex').lean();

        const indices = new Set<number>();
        for (const session of activeSessions) {
            if (session.largeSubnetAllocation?.allocatedSubnetIndex !== undefined) {
                indices.add(session.largeSubnetAllocation.allocatedSubnetIndex);
            }
        }

        return indices;
    }

    /**
     * Find available subnet with collision resolution
     * Uses +1 wraparound when collisions occur
     * 
     * @param studentId - Student's ID for hashing
     * @param labId - Lab ID for scoping allocation
     * @param config - Large subnet configuration from lab
     * @returns AllocationResult with subnet details
     * @throws Error if all subnets are allocated
     */
    static async allocateSubnet(
        studentId: string,
        labId: Types.ObjectId,
        config: LargeSubnetConfig
    ): Promise<AllocationResult> {
        const totalSubnets = this.getTotalSubnets(config);
        const allocatedIndices = await this.getAllocatedIndices(labId);

        // Start with hashed index
        let currentIndex = this.hashStudentId(studentId, totalSubnets);
        let attempts = 0;

        console.log(`[LargeSubnetAllocator] Student ${studentId} - Initial hash index: ${currentIndex}, Total subnets: ${totalSubnets}`);

        // Collision resolution: +1 wraparound
        while (allocatedIndices.has(currentIndex) && attempts < totalSubnets) {
            currentIndex = (currentIndex + 1) % totalSubnets;
            attempts++;
        }

        if (attempts > 0) {
            console.log(`[LargeSubnetAllocator] Collision resolved after ${attempts} attempts, final index: ${currentIndex}`);
        }

        if (attempts >= totalSubnets) {
            throw new Error('All subnets are allocated - no space available in the pool');
        }

        // Generate VLAN IDs based on configuration
        const vlanCount = config.subVlans.filter(v => v.vlanIdRandomized).length;
        const randomVlanIds = this.generateRandomVlanIds(vlanCount);

        // Map randomized VLAN IDs to actual VLAN configuration
        const finalVlanIds: number[] = [];
        let randomIndex = 0;

        for (const subVlan of config.subVlans) {
            if (subVlan.vlanIdRandomized) {
                finalVlanIds.push(randomVlanIds[randomIndex++]);
            } else {
                finalVlanIds.push(subVlan.fixedVlanId || 2);
            }
        }

        return {
            subnetIndex: currentIndex,
            subnetCIDR: this.calculateSubnetCIDR(config, currentIndex),
            networkAddress: this.calculateNetworkAddress(config, currentIndex),
            randomizedVlanIds: finalVlanIds
        };
    }

    /**
     * Calculate IP address within a sub-VLAN of the student's allocated subnet
     * 
     * @param allocation - Student's allocated large subnet
     * @param subVlanConfig - Sub-VLAN configuration
     * @param interfaceOffset - Offset within the sub-VLAN (1-based)
     * @returns IP address string
     */
    static calculateSubVlanIP(
        allocation: AllocationResult,
        subVlanConfig: LargeSubnetConfig['subVlans'][0],
        interfaceOffset: number
    ): string {
        // Parse the network address
        const octets = allocation.networkAddress.split('.').map(Number);
        const networkNum = (octets[0] << 24) + (octets[1] << 16) + (octets[2] << 8) + octets[3];

        // Calculate the sub-VLAN block size
        const subVlanBlockSize = Math.pow(2, 32 - subVlanConfig.subnetSize);

        // Calculate the starting address for this sub-VLAN
        const subVlanStart = networkNum + ((subVlanConfig.subnetIndex - 1) * subVlanBlockSize);

        // Add the interface offset
        const ipNum = subVlanStart + interfaceOffset;

        // Convert back to dotted decimal
        return [
            (ipNum >>> 24) & 0xFF,
            (ipNum >>> 16) & 0xFF,
            (ipNum >>> 8) & 0xFF,
            ipNum & 0xFF
        ].join('.');
    }

    /**
     * Get sub-VLAN network address
     */
    static getSubVlanNetwork(
        allocation: AllocationResult,
        subVlanConfig: LargeSubnetConfig['subVlans'][0]
    ): string {
        // Parse the network address
        const octets = allocation.networkAddress.split('.').map(Number);
        const networkNum = (octets[0] << 24) + (octets[1] << 16) + (octets[2] << 8) + octets[3];

        // Calculate the sub-VLAN block size
        const subVlanBlockSize = Math.pow(2, 32 - subVlanConfig.subnetSize);

        // Calculate the starting address for this sub-VLAN
        const subVlanStart = networkNum + ((subVlanConfig.subnetIndex - 1) * subVlanBlockSize);

        // Convert back to dotted decimal
        return [
            (subVlanStart >>> 24) & 0xFF,
            (subVlanStart >>> 16) & 0xFF,
            (subVlanStart >>> 8) & 0xFF,
            subVlanStart & 0xFF
        ].join('.');
    }
}
