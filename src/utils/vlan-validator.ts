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
      } else if (ipVar.interfaceOffset < 1 || ipVar.interfaceOffset > 50) {
        errors.push(`interfaceOffset must be between 1 and 50, got ${ipVar.interfaceOffset}`);
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
}
