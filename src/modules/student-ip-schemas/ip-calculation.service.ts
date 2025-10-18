/**
 * IP Calculation Service
 *
 * Provides utilities for subnet calculations, VLSM allocation, and host IP calculations
 * as specified in the Backend Implementation Specification.
 */

export interface SubnetCalculation {
  networkAddress: string;
  firstUsableIp: string;
  lastUsableIp: string;
  broadcastAddress: string;
  subnetMask: number;
  subnetIndex: number;
  usableHosts: number;
}

export interface VlanRequirement {
  vlanIndex: number;
  minHosts: number;
}

export interface VlanAllocation extends SubnetCalculation {
  vlanIndex: number;
}

/**
 * Convert IP string to 32-bit number
 * @param ip - IP address string (e.g., "172.16.40.128")
 * @returns 32-bit number representation
 */
export function ipToNumber(ip: string): number {
  const octets = ip.split('.').map(Number);
  return (octets[0] << 24) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
}

/**
 * Convert 32-bit number to IP string
 * @param num - 32-bit number
 * @returns IP address string
 */
export function numberToIp(num: number): string {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255
  ].join('.');
}

/**
 * Calculate the smallest subnet mask that can fit required hosts
 *
 * @param requiredHosts - Minimum number of usable host IPs needed
 * @returns CIDR prefix length (e.g., 26 for /26)
 *
 * Formula:
 * - Usable hosts = 2^(32-prefix) - 2
 * - Find smallest prefix where usable hosts >= requiredHosts
 */
export function calculateSubnetMask(requiredHosts: number): number {
  for (let prefix = 30; prefix >= 1; prefix--) {
    const usableHosts = Math.pow(2, 32 - prefix) - 2;
    if (usableHosts >= requiredHosts) {
      return prefix;
    }
  }
  throw new Error(`Cannot fit ${requiredHosts} hosts in any valid subnet`);
}

/**
 * Calculate network address, first/last usable, and broadcast
 *
 * @param baseIp - Base network IP (e.g., "172.16.40.128")
 * @param prefixLength - Subnet mask in CIDR (e.g., 27)
 * @param subnetIndex - Which subnet block (0 = first, 1 = second, etc.)
 * @returns Subnet details
 */
export function calculateSubnet(
  baseIp: string,
  prefixLength: number,
  subnetIndex: number
): SubnetCalculation {
  // 1. Calculate block size
  const blockSize = Math.pow(2, 32 - prefixLength);

  // 2. Convert base IP to number
  const baseIpNum = ipToNumber(baseIp);

  // 3. Calculate network address
  const networkNum = baseIpNum + (subnetIndex * blockSize);
  const networkAddress = numberToIp(networkNum);

  // 4. Calculate first usable IP (network + 1)
  const firstUsableIp = numberToIp(networkNum + 1);

  // 5. Calculate broadcast address (network + blockSize - 1)
  const broadcastNum = networkNum + blockSize - 1;
  const broadcastAddress = numberToIp(broadcastNum);

  // 6. Calculate last usable IP (broadcast - 1)
  const lastUsableIp = numberToIp(broadcastNum - 1);

  // 7. Calculate usable hosts
  const usableHosts = blockSize - 2;

  return {
    networkAddress,
    firstUsableIp,
    lastUsableIp,
    broadcastAddress,
    subnetMask: prefixLength,
    subnetIndex,
    usableHosts
  };
}

/**
 * Calculate IP for a specific host position in subnet
 *
 * @param subnet - Subnet calculation result
 * @param position - Host position: 'first', 'second', 'last', or specific number
 * @returns IP address string
 */
export function getHostIp(
  subnet: SubnetCalculation,
  position: 'first' | 'second' | 'last' | number
): string {
  const networkNum = ipToNumber(subnet.networkAddress);

  if (position === 'first') {
    // First usable = network + 1
    return numberToIp(networkNum + 1);
  } else if (position === 'second') {
    // Second usable = network + 2
    return numberToIp(networkNum + 2);
  } else if (position === 'last') {
    // Last usable = broadcast - 1
    const broadcastNum = ipToNumber(subnet.broadcastAddress);
    return numberToIp(broadcastNum - 1);
  } else if (typeof position === 'number') {
    // Specific host number (1-indexed)
    if (position < 1 || position > subnet.usableHosts) {
      throw new Error(`Host ${position} out of range (1-${subnet.usableHosts})`);
    }
    return numberToIp(networkNum + position);
  }

  throw new Error(`Invalid position: ${position}`);
}

/**
 * Allocate multiple VLANs using VLSM from a base network
 * Allocates largest subnets first to avoid fragmentation
 *
 * @param baseNetwork - Base network (e.g., "172.16.40.128")
 * @param basePrefix - Base prefix length (e.g., 25)
 * @param requirements - Array of VLAN requirements sorted by size (largest first)
 * @returns Array of subnet allocations
 */
export function allocateVlans(
  baseNetwork: string,
  basePrefix: number,
  requirements: VlanRequirement[]
): VlanAllocation[] {
  // Sort requirements by minHosts descending (largest first)
  const sorted = [...requirements].sort((a, b) => b.minHosts - a.minHosts);

  const allocations: VlanAllocation[] = [];
  let currentSubnetIndex = 0;

  for (const req of sorted) {
    // Calculate required subnet mask
    const subnetMask = calculateSubnetMask(req.minHosts);

    // Validate subnet can fit in base network
    if (subnetMask < basePrefix) {
      throw new Error(
        `VLAN ${req.vlanIndex} requires /${subnetMask} but base is /${basePrefix}`
      );
    }

    // Calculate subnet
    const subnet = calculateSubnet(baseNetwork, subnetMask, currentSubnetIndex);

    // Add to allocations
    allocations.push({
      ...subnet,
      vlanIndex: req.vlanIndex
    });

    // Move to next subnet block
    // Block size determines how many subnet slots are consumed
    const blockSize = Math.pow(2, 32 - subnetMask);
    const baseBlockSize = Math.pow(2, 32 - basePrefix);
    currentSubnetIndex += Math.ceil(blockSize / baseBlockSize);
  }

  return allocations;
}

/**
 * Validate IP address format
 * @param ip - IP address string
 * @returns true if valid IPv4 address
 */
export function isValidIpAddress(ip: string): boolean {
  const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  if (!ipRegex.test(ip)) {
    return false;
  }

  const octets = ip.split('.').map(Number);
  return octets.every(octet => octet >= 0 && octet <= 255);
}

/**
 * Validate CIDR prefix length
 * @param prefix - CIDR prefix (1-32)
 * @returns true if valid
 */
export function isValidCidrPrefix(prefix: number): boolean {
  return Number.isInteger(prefix) && prefix >= 1 && prefix <= 32;
}

/**
 * Check if an IP is within a subnet
 * @param ip - IP address to check
 * @param networkAddress - Network address of subnet
 * @param subnetMask - CIDR prefix length
 * @returns true if IP is within subnet
 */
export function isIpInSubnet(ip: string, networkAddress: string, subnetMask: number): boolean {
  const ipNum = ipToNumber(ip);
  const networkNum = ipToNumber(networkAddress);
  const blockSize = Math.pow(2, 32 - subnetMask);
  const broadcastNum = networkNum + blockSize - 1;

  return ipNum >= networkNum && ipNum <= broadcastNum;
}

/**
 * Check if an IP is within a range
 * @param ip - IP address to check
 * @param startIp - Start IP of range
 * @param endIp - End IP of range
 * @returns true if IP is within range (inclusive)
 */
export function isIpInRange(ip: string, startIp: string, endIp: string): boolean {
  const ipNum = ipToNumber(ip);
  const startNum = ipToNumber(startIp);
  const endNum = ipToNumber(endIp);

  return ipNum >= startNum && ipNum <= endNum;
}

/**
 * Construct DHCP IP from base network and offset
 * @param baseNetwork - Base network (e.g., "172.16.0.0")
 * @param offset - Host offset (1-254)
 * @returns Full IP address
 */
export function constructDhcpIp(baseNetwork: string, offset: number): string {
  const parts = baseNetwork.split('.');
  parts[3] = String(offset);
  return parts.join('.');
}
