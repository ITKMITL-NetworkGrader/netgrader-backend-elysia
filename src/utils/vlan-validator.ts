/**
 * VLAN Configuration Validation Utility
 * Validates VLAN configurations for lab creation
 */

interface VlanConfig {
  mode: 'fixed_vlan' | 'lecturer_group' | 'calculated_vlan';
  vlanCount: number;
  vlans: Array<{
    id: string;
    vlanId?: number;
    calculationMultiplier?: number;
    baseNetwork: string;
    subnetMask: number;
    subnetIndex: number;
    groupModifier?: number;
    isStudentGenerated: boolean;
  }>;
}

export class VlanValidator {
  /**
   * Validate complete VLAN configuration
   */
  static validateVlanConfiguration(config: VlanConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate vlanCount matches vlans array length
    if (config.vlanCount !== config.vlans.length) {
      errors.push(`vlanCount (${config.vlanCount}) does not match number of VLANs (${config.vlans.length})`);
    }

    // Validate vlanCount range
    if (config.vlanCount < 1 || config.vlanCount > 10) {
      errors.push(`vlanCount must be between 1 and 10, got ${config.vlanCount}`);
    }

    // Validate each VLAN based on mode
    config.vlans.forEach((vlan, index) => {
      const vlanErrors = this.validateVlan(vlan, config.mode, index);
      errors.push(...vlanErrors);
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate individual VLAN based on mode
   */
  private static validateVlan(
    vlan: VlanConfig['vlans'][0],
    mode: VlanConfig['mode'],
    index: number
  ): string[] {
    const errors: string[] = [];

    // Validate base network format
    if (!this.isValidIPv4(vlan.baseNetwork)) {
      errors.push(`VLAN ${index}: Invalid base network format '${vlan.baseNetwork}'`);
    }

    // Validate subnet mask range
    if (vlan.subnetMask < 8 || vlan.subnetMask > 30) {
      errors.push(`VLAN ${index}: Subnet mask must be between 8 and 30, got ${vlan.subnetMask}`);
    }

    // Validate subnet index
    if (vlan.subnetIndex === undefined || vlan.subnetIndex === null) {
      errors.push(`VLAN ${index}: subnetIndex is required`);
    } else if (vlan.subnetIndex < 0) {
      errors.push(`VLAN ${index}: subnetIndex must be >= 0, got ${vlan.subnetIndex}`);
    } else {
      // Validate that subnetIndex doesn't cause fourth octet overflow
      const blockSize = Math.pow(2, 32 - vlan.subnetMask);
      const maxHostAddress = vlan.subnetIndex * blockSize;
      if (maxHostAddress > 254 && vlan.subnetMask < 24 && vlan.subnetIndex > 0) {
        errors.push(
          `VLAN ${index}: subnetIndex ${vlan.subnetIndex} with /${vlan.subnetMask} subnet ` +
          `would start at .${maxHostAddress}, exceeding valid range (max .254). ` +
          `Use smaller subnetIndex or larger subnet mask.`
        );
      }
    }

    // Mode-specific validation
    switch (mode) {
      case 'fixed_vlan':
      case 'lecturer_group':
        if (vlan.vlanId === undefined) {
          errors.push(`VLAN ${index}: vlanId is required for ${mode} mode`);
        } else if (vlan.vlanId < 1 || vlan.vlanId > 4094) {
          errors.push(`VLAN ${index}: vlanId must be between 1 and 4094, got ${vlan.vlanId}`);
        }

        if (mode === 'lecturer_group' && vlan.groupModifier === undefined) {
          errors.push(`VLAN ${index}: groupModifier is required for lecturer_group mode`);
        }
        break;

      case 'calculated_vlan':
        if (vlan.calculationMultiplier === undefined) {
          errors.push(`VLAN ${index}: calculationMultiplier is required for calculated_vlan mode`);
        } else if (vlan.calculationMultiplier <= 0) {
          errors.push(`VLAN ${index}: calculationMultiplier must be positive, got ${vlan.calculationMultiplier}`);
        }
        break;
    }

    return errors;
  }

  /**
   * Validate IPv4 address format
   */
  private static isValidIPv4(ip: string): boolean {
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = ip.match(ipv4Regex);

    if (!match) return false;

    // Check each octet is 0-255
    for (let i = 1; i <= 4; i++) {
      const octet = parseInt(match[i], 10);
      if (octet < 0 || octet > 255) return false;
    }

    return true;
  }

  /**
   * Validate IP variable configuration
   */
  static validateIPVariable(
    ipVar: any,
    vlanConfig?: VlanConfig
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate inputType
    const validInputTypes = [
      'fullIP',
      'studentManagement',
      'studentVlan0',
      'studentVlan1',
      'studentVlan2',
      'studentVlan3',
      'studentVlan4',
      'studentVlan5',
      'studentVlan6',
      'studentVlan7',
      'studentVlan8',
      'studentVlan9'
    ];

    if (!validInputTypes.includes(ipVar.inputType)) {
      errors.push(`Invalid inputType '${ipVar.inputType}'`);
    }

    // Validate fullIP type
    if (ipVar.inputType === 'fullIP') {
      if (!ipVar.fullIp) {
        errors.push(`fullIp is required when inputType is 'fullIP'`);
      } else if (!this.isValidIPv4(ipVar.fullIp)) {
        errors.push(`Invalid IPv4 address format '${ipVar.fullIp}'`);
      }
    }

    // Validate studentManagement type
    if (ipVar.inputType === 'studentManagement') {
      if (!ipVar.isManagementInterface) {
        errors.push(`isManagementInterface must be true for studentManagement inputType`);
      }
    }

    // Validate studentVlan types
    if (ipVar.inputType.startsWith('studentVlan')) {
      if (!ipVar.isVlanInterface) {
        errors.push(`isVlanInterface must be true for ${ipVar.inputType} inputType`);
      }

      if (ipVar.vlanIndex === undefined || ipVar.vlanIndex === null) {
        errors.push(`vlanIndex is required for ${ipVar.inputType} inputType`);
      } else if (ipVar.vlanIndex < 0 || ipVar.vlanIndex > 9) {
        errors.push(`vlanIndex must be between 0 and 9, got ${ipVar.vlanIndex}`);
      }

      // Validate vlanIndex matches the inputType suffix
      const expectedVlanIndex = parseInt(ipVar.inputType.replace('studentVlan', ''), 10);
      if (ipVar.vlanIndex !== expectedVlanIndex) {
        errors.push(
          `vlanIndex (${ipVar.vlanIndex}) does not match inputType (${ipVar.inputType})`
        );
      }

      // Validate vlanIndex is within vlanConfiguration bounds
      if (vlanConfig && ipVar.vlanIndex >= vlanConfig.vlanCount) {
        errors.push(
          `vlanIndex (${ipVar.vlanIndex}) exceeds available VLANs (${vlanConfig.vlanCount})`
        );
      }

      if (ipVar.interfaceOffset === undefined || ipVar.interfaceOffset === null) {
        errors.push(`interfaceOffset is required for ${ipVar.inputType} inputType`);
      } else if (ipVar.interfaceOffset < 1 || ipVar.interfaceOffset > 254) {
        errors.push(`interfaceOffset must be between 1 and 254, got ${ipVar.interfaceOffset}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate that IP variable references in task parameters exist in lab devices
   */
  static validateIPParameterReference(
    reference: string,
    labDevices: Array<{ deviceId: string; ipVariables: Array<{ name: string }> }>
  ): { valid: boolean; error?: string } {
    // Check if it's an IP variable reference (format: deviceId.variableName)
    if (!reference.includes('.')) {
      // Not a reference, might be a direct IP - validate IPv4 format
      if (this.isValidIPv4(reference)) {
        return { valid: true };
      }
      return { valid: false, error: `'${reference}' is neither a valid IP variable reference nor a valid IPv4 address` };
    }

    const [deviceId, variableName] = reference.split('.');

    // Find device
    const device = labDevices.find(d => d.deviceId === deviceId);
    if (!device) {
      return { valid: false, error: `Device '${deviceId}' not found in lab configuration` };
    }

    // Find IP variable
    const ipVar = device.ipVariables.find(v => v.name === variableName);
    if (!ipVar) {
      return { valid: false, error: `IP variable '${variableName}' not found in device '${deviceId}'` };
    }

    return { valid: true };
  }

  /**
   * Check for duplicate IP configurations across devices
   */
  static checkDuplicateIPs(
    devices: Array<{
      deviceId: string;
      ipVariables: Array<{
        inputType: string;
        isManagementInterface?: boolean;
        vlanIndex?: number;
        interfaceOffset?: number;
      }>;
    }>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const ipKeys = new Set<string>();

    devices.forEach(device => {
      device.ipVariables.forEach(ipVar => {
        let key: string;

        if (ipVar.inputType === 'studentManagement' || ipVar.isManagementInterface) {
          key = 'mgmt:single';
        } else if (ipVar.inputType.startsWith('studentVlan') && ipVar.vlanIndex !== undefined) {
          key = `vlan:${ipVar.vlanIndex}:${ipVar.interfaceOffset || 0}`;
        } else {
          return; // Skip fullIP types
        }

        if (ipKeys.has(key)) {
          errors.push(
            `Duplicate IP configuration detected in device '${device.deviceId}': ${key}`
          );
        }
        ipKeys.add(key);
      });
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate exempt IP ranges for Management network
   */
  static validateExemptRanges(
    exemptRanges: Array<{ start: string; end?: string }>,
    baseNetwork: string,
    subnetMask: number
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. Max 20 ranges
    if (exemptRanges.length > 20) {
      errors.push('Maximum 20 exempt ranges allowed');
    }

    // 2. Validate each range
    for (let i = 0; i < exemptRanges.length; i++) {
      const range = exemptRanges[i];

      // Valid IPv4 format
      if (!this.isValidIPv4(range.start)) {
        errors.push(`Range ${i + 1}: Invalid start IP '${range.start}'`);
        continue; // Skip further validation for this range
      }

      if (range.end && !this.isValidIPv4(range.end)) {
        errors.push(`Range ${i + 1}: Invalid end IP '${range.end}'`);
        continue;
      }

      // Range logic (start <= end)
      if (range.end) {
        const startNum = this.ipToNumber(range.start);
        const endNum = this.ipToNumber(range.end);
        if (startNum > endNum) {
          errors.push(
            `Range ${i + 1}: Invalid range ${range.start} - ${range.end} (start > end)`
          );
        }
      }

      // Within management network boundaries
      if (!this.isIpInNetwork(range.start, baseNetwork, subnetMask)) {
        errors.push(
          `Range ${i + 1}: IP ${range.start} is outside management network ${baseNetwork}/${subnetMask}`
        );
      }

      if (range.end && !this.isIpInNetwork(range.end, baseNetwork, subnetMask)) {
        errors.push(
          `Range ${i + 1}: IP ${range.end} is outside management network ${baseNetwork}/${subnetMask}`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Convert IP address to number for comparison
   */
  static ipToNumber(ip: string): number {
    const parts = ip.split('.').map(Number);
    return (parts[0] * 16777216) + (parts[1] * 65536) + (parts[2] * 256) + parts[3];
  }

  /**
   * Check if IP is within network boundaries
   */
  static isIpInNetwork(ip: string, baseNetwork: string, subnetMask: number): boolean {
    const ipNum = this.ipToNumber(ip);
    const networkNum = this.ipToNumber(baseNetwork);
    const maskBits = 0xFFFFFFFF << (32 - subnetMask);
    return (ipNum & maskBits) === (networkNum & maskBits);
  }

  /**
   * Check if IP is in any exempt range
   */
  static isIpInExemptRanges(
    ip: string,
    exemptRanges: Array<{ start: string; end?: string }> | undefined
  ): boolean {
    if (!exemptRanges || exemptRanges.length === 0) {
      return false;
    }

    const ipNum = this.ipToNumber(ip);

    for (const range of exemptRanges) {
      const startNum = this.ipToNumber(range.start);
      const endNum = range.end ? this.ipToNumber(range.end) : startNum;

      if (ipNum >= startNum && ipNum <= endNum) {
        return true;
      }
    }

    return false;
  }

  // ============================================================
  // IPv6 Validation Methods
  // ============================================================

  /**
   * Validate IPv6 address format (supports both full and compressed formats)
   */
  static isValidIPv6(ip: string): boolean {
    if (!ip) return false;

    // Remove prefix length if present
    const addressPart = ip.split('/')[0];

    // Handle special cases
    if (addressPart === '::1') return true;  // Loopback
    if (addressPart === '::') return true;   // Unspecified

    // Full IPv6 regex (8 groups of 1-4 hex chars)
    const fullIPv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

    // Compressed IPv6 regex (handles :: compression)
    const compressedIPv6Regex = /^(([0-9a-fA-F]{1,4}:){0,7}[0-9a-fA-F]{1,4})?::?(([0-9a-fA-F]{1,4}:){0,7}[0-9a-fA-F]{1,4})?$/;

    return fullIPv6Regex.test(addressPart) || compressedIPv6Regex.test(addressPart);
  }

  /**
   * Validate IPv6 prefix length
   */
  static isValidIPv6PrefixLength(length: number): boolean {
    return Number.isInteger(length) && length >= 0 && length <= 128;
  }

  /**
   * Validate IPv6 template syntax with placeholders
   */
  static validateIPv6Template(template: string): {
    valid: boolean;
    errors: string[];
    warnings: string[]
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!template) {
      errors.push('Template is required');
      return { valid: false, errors, warnings };
    }

    // Check for required placeholders
    const requiredPlaceholders = ['{VLAN}', '{offset}'];
    const recommendedPlaceholders = ['{X}', '{Y}'];
    const validPlaceholders = ['{X}', '{Y}', '{Z}', '{VLAN}', '{offset}', '{last3}', '{X_hex}', '{Y_hex}'];

    for (const placeholder of requiredPlaceholders) {
      if (!template.includes(placeholder)) {
        errors.push(`Missing required placeholder: ${placeholder}`);
      }
    }

    for (const placeholder of recommendedPlaceholders) {
      if (!template.includes(placeholder)) {
        warnings.push(`Consider using placeholder: ${placeholder} for student uniqueness`);
      }
    }

    // Check for valid IPv6 structure
    if (!template.includes('::') && !template.includes(':')) {
      errors.push('Template must contain IPv6 colons');
    }

    // Check for prefix length
    if (!template.includes('/')) {
      warnings.push('Template should include prefix length (e.g., /64)');
    }

    // Check for unknown placeholders
    const placeholderRegex = /\{[^}]+\}/g;
    const foundPlaceholders = template.match(placeholderRegex) || [];

    for (const found of foundPlaceholders) {
      if (!validPlaceholders.includes(found)) {
        errors.push(`Unknown placeholder: ${found}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate IPv6 configuration for a VLAN
   */
  static validateVlanIPv6Configuration(
    vlanConfig: {
      ipv6Enabled?: boolean;
      ipv6VlanAlphabet?: string;
      ipv6SubnetId?: string;
    },
    ipv6Config?: {
      enabled: boolean;
      template?: string;
      globalPrefix?: string;
      prefixMode?: 'template' | 'structured';
    }
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // If VLAN has IPv6 enabled but lab doesn't, that's an error
    if (vlanConfig.ipv6Enabled && !ipv6Config?.enabled) {
      errors.push('VLAN has IPv6 enabled but lab IPv6 is disabled');
    }

    // Validate VLAN alphabet if provided
    if (vlanConfig.ipv6VlanAlphabet) {
      if (!/^[A-Z]$/.test(vlanConfig.ipv6VlanAlphabet)) {
        errors.push(`Invalid VLAN alphabet '${vlanConfig.ipv6VlanAlphabet}'. Must be a single uppercase letter A-Z`);
      }
    }

    // Validate subnet ID if provided
    if (vlanConfig.ipv6SubnetId) {
      // Subnet ID should be valid hex (1-4 chars) or a number
      if (!/^[0-9a-fA-F]{1,4}$/.test(vlanConfig.ipv6SubnetId) && isNaN(parseInt(vlanConfig.ipv6SubnetId, 10))) {
        errors.push(`Invalid subnet ID '${vlanConfig.ipv6SubnetId}'. Must be 1-4 hex characters or a number`);
      }
    }

    // If structured mode, global prefix is required
    if (ipv6Config?.prefixMode === 'structured' && !ipv6Config.globalPrefix) {
      errors.push('Global prefix is required for structured prefix mode');
    }

    // Validate global prefix format if provided
    if (ipv6Config?.globalPrefix) {
      const prefixParts = ipv6Config.globalPrefix.split(':');
      for (const part of prefixParts) {
        if (part && !/^[0-9a-fA-F]{1,4}$/.test(part)) {
          errors.push(`Invalid hex group in global prefix: ${part}`);
          break;
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if an IPv6 address is a link-local address (starts with fe80::)
   */
  static isLinkLocalIPv6(address: string): boolean {
    if (!address) return false;
    const normalized = address.toLowerCase().split('/')[0];
    return normalized.startsWith('fe80:');
  }

  /**
   * Expand compressed IPv6 address to full format for comparison
   */
  static expandIPv6Address(address: string): string {
    if (!address) return '';

    // Remove prefix length
    const [addressPart] = address.split('/');

    // Handle :: compression
    const parts = addressPart.split('::');
    let groups: string[];

    if (parts.length === 2) {
      const left = parts[0] ? parts[0].split(':') : [];
      const right = parts[1] ? parts[1].split(':') : [];
      const fillCount = 8 - left.length - right.length;
      const fill = Array(fillCount).fill('0000');
      groups = [...left, ...fill, ...right];
    } else {
      groups = addressPart.split(':');
    }

    // Pad each group to 4 characters
    const expandedGroups = groups.map(g => g.padStart(4, '0').toLowerCase());

    return expandedGroups.join(':');
  }

  /**
   * Compare two IPv6 addresses for equality (handles compression and case)
   */
  static compareIPv6Addresses(addr1: string, addr2: string): boolean {
    if (!addr1 || !addr2) return false;

    // Remove prefix length for comparison
    const clean1 = addr1.split('/')[0];
    const clean2 = addr2.split('/')[0];

    // Compare expanded forms
    return this.expandIPv6Address(clean1) === this.expandIPv6Address(clean2);
  }
}
