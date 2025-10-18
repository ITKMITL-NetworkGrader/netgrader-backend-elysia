/**
 * Part Validation Utilities
 *
 * Validation rules for lab parts including questions, dhcpConfiguration, and tasks
 */

export class PartValidator {
  /**
   * Validate part data based on partType
   */
  static validatePartData(partData: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const { partType, questions, tasks, task_groups, dhcpConfiguration } = partData;

    // Validate partType
    if (!partType || !['fill_in_blank', 'network_config', 'dhcp_config'].includes(partType)) {
      errors.push('Invalid partType. Must be one of: fill_in_blank, network_config, dhcp_config');
      return { valid: false, errors };
    }

    // Validate based on partType
    if (partType === 'fill_in_blank') {
      if (!questions || questions.length === 0) {
        errors.push('fill_in_blank part must have questions');
      }
      if (tasks && tasks.length > 0) {
        errors.push('fill_in_blank part cannot have tasks');
      }
      if (dhcpConfiguration) {
        errors.push('fill_in_blank part cannot have dhcpConfiguration');
      }

      // Validate questions
      if (questions && questions.length > 0) {
        const questionErrors = this.validateQuestions(questions);
        errors.push(...questionErrors);
      }
    } else if (partType === 'dhcp_config') {
      if (!dhcpConfiguration) {
        errors.push('dhcp_config part must have dhcpConfiguration');
      }
      if (tasks && tasks.length > 0) {
        errors.push('dhcp_config part cannot have tasks');
      }
      if (questions && questions.length > 0) {
        errors.push('dhcp_config part cannot have questions');
      }

      // Validate dhcpConfiguration
      if (dhcpConfiguration) {
        const dhcpErrors = this.validateDhcpConfiguration(dhcpConfiguration);
        errors.push(...dhcpErrors);
      }
    } else if (partType === 'network_config') {
      if (!tasks || tasks.length === 0) {
        errors.push('network_config part must have tasks');
      }
      if (questions && questions.length > 0) {
        errors.push('network_config part cannot have questions');
      }
      if (dhcpConfiguration) {
        errors.push('network_config part cannot have dhcpConfiguration');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate questions array
   */
  static validateQuestions(questions: any[]): string[] {
    const errors: string[] = [];

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      const prefix = `Question ${i + 1} (${question.questionId || 'unknown'})`;

      // Required fields
      if (!question.questionId) {
        errors.push(`${prefix}: questionId is required`);
      }
      if (!question.questionText) {
        errors.push(`${prefix}: questionText is required`);
      }
      if (!question.questionType) {
        errors.push(`${prefix}: questionType is required`);
      }
      if (question.points === undefined || question.points < 0) {
        errors.push(`${prefix}: points must be >= 0`);
      }
      if (!question.expectedAnswerType || !['exact', 'range'].includes(question.expectedAnswerType)) {
        errors.push(`${prefix}: expectedAnswerType must be 'exact' or 'range'`);
      }

      // Validate based on questionType
      if (question.questionType === 'custom_text') {
        if (!question.expectedAnswer) {
          errors.push(`${prefix}: custom_text questions require expectedAnswer`);
        }
        if (question.schemaMapping) {
          errors.push(`${prefix}: custom_text questions must NOT have schemaMapping`);
        }
      } else if (question.questionType === 'ip_table_questionnaire') {
        if (!question.ipTableQuestionnaire) {
          errors.push(`${prefix}: ip_table_questionnaire questions require ipTableQuestionnaire object`);
        } else {
          const tableErrors = this.validateIpTableQuestionnaire(question.ipTableQuestionnaire, prefix);
          errors.push(...tableErrors);
        }
        if (question.schemaMapping) {
          errors.push(`${prefix}: ip_table_questionnaire questions must NOT have schemaMapping`);
        }
      } else {
        // Network-focused questions (need schemaMapping)
        if (!question.schemaMapping) {
          errors.push(`${prefix}: ${question.questionType} questions require schemaMapping`);
        } else {
          const mappingErrors = this.validateSchemaMapping(question.schemaMapping, prefix);
          errors.push(...mappingErrors);
        }
      }
    }

    return errors;
  }

  /**
   * Validate schemaMapping
   */
  static validateSchemaMapping(schemaMapping: any, prefix: string): string[] {
    const errors: string[] = [];

    if (schemaMapping.vlanIndex === undefined) {
      errors.push(`${prefix}: schemaMapping.vlanIndex is required`);
    } else if (schemaMapping.vlanIndex < 0 || schemaMapping.vlanIndex > 9) {
      errors.push(`${prefix}: schemaMapping.vlanIndex must be between 0-9`);
    }

    if (!schemaMapping.field) {
      errors.push(`${prefix}: schemaMapping.field is required`);
    } else if (!['networkAddress', 'subnetMask', 'firstUsableIp', 'lastUsableIp', 'broadcastAddress'].includes(schemaMapping.field)) {
      errors.push(`${prefix}: schemaMapping.field must be one of: networkAddress, subnetMask, firstUsableIp, lastUsableIp, broadcastAddress`);
    }

    return errors;
  }

  /**
   * Validate IP Table Questionnaire
   */
  static validateIpTableQuestionnaire(table: any, prefix: string): string[] {
    const errors: string[] = [];

    // Validate required fields
    if (!table.tableId) {
      errors.push(`${prefix}: ipTableQuestionnaire.tableId is required`);
    }
    if (!table.rowCount || table.rowCount < 1 || table.rowCount > 10) {
      errors.push(`${prefix}: ipTableQuestionnaire.rowCount must be between 1-10`);
    }
    if (!table.columnCount || table.columnCount < 1 || table.columnCount > 10) {
      errors.push(`${prefix}: ipTableQuestionnaire.columnCount must be between 1-10`);
    }

    // Validate columns
    if (!table.columns || !Array.isArray(table.columns)) {
      errors.push(`${prefix}: ipTableQuestionnaire.columns is required and must be an array`);
    } else {
      if (table.columns.length !== table.columnCount) {
        errors.push(`${prefix}: columns.length (${table.columns.length}) must equal columnCount (${table.columnCount})`);
      }
      for (const col of table.columns) {
        if (!col.label || !col.label.trim()) {
          errors.push(`${prefix}: All columns must have non-empty label`);
        }
      }
    }

    // Validate rows
    if (!table.rows || !Array.isArray(table.rows)) {
      errors.push(`${prefix}: ipTableQuestionnaire.rows is required and must be an array`);
    } else {
      if (table.rows.length !== table.rowCount) {
        errors.push(`${prefix}: rows.length (${table.rows.length}) must equal rowCount (${table.rowCount})`);
      }
      for (const row of table.rows) {
        if (!row.deviceId) {
          errors.push(`${prefix}: All rows must have deviceId`);
        }
        if (!row.interfaceName) {
          errors.push(`${prefix}: All rows must have interfaceName`);
        }
      }
    }

    // Validate cells
    if (!table.cells || !Array.isArray(table.cells)) {
      errors.push(`${prefix}: ipTableQuestionnaire.cells is required and must be a 2D array`);
    } else {
      if (table.cells.length !== table.rowCount) {
        errors.push(`${prefix}: cells must have ${table.rowCount} rows`);
      }
      for (let rowIdx = 0; rowIdx < table.cells.length; rowIdx++) {
        const row = table.cells[rowIdx];
        if (!Array.isArray(row)) {
          errors.push(`${prefix}: cells[${rowIdx}] must be an array`);
          continue;
        }
        if (row.length !== table.columnCount) {
          errors.push(`${prefix}: cells[${rowIdx}] must have ${table.columnCount} columns`);
        }
        for (let colIdx = 0; colIdx < row.length; colIdx++) {
          const cell = row[colIdx];
          const cellErrors = this.validateTableCell(cell, `${prefix}: cells[${rowIdx}][${colIdx}]`);
          errors.push(...cellErrors);
        }
      }
    }

    return errors;
  }

  /**
   * Validate individual table cell
   */
  static validateTableCell(cell: any, prefix: string): string[] {
    const errors: string[] = [];

    if (!cell.answerType || !['static', 'calculated'].includes(cell.answerType)) {
      errors.push(`${prefix}: answerType must be 'static' or 'calculated'`);
    }

    if (cell.points === undefined || cell.points < 1) {
      errors.push(`${prefix}: points must be >= 1`);
    }

    if (cell.answerType === 'static') {
      if (!cell.staticAnswer || !cell.staticAnswer.trim()) {
        errors.push(`${prefix}: static answers require non-empty staticAnswer`);
      }
    } else if (cell.answerType === 'calculated') {
      if (!cell.calculatedAnswer) {
        errors.push(`${prefix}: calculated answers require calculatedAnswer object`);
      } else {
        const calcErrors = this.validateCalculatedAnswer(cell.calculatedAnswer, prefix);
        errors.push(...calcErrors);
      }
    }

    return errors;
  }

  /**
   * Validate calculated answer configuration
   */
  static validateCalculatedAnswer(calc: any, prefix: string): string[] {
    const errors: string[] = [];

    const validTypes = [
      'vlan_network_address', 'vlan_first_usable', 'vlan_last_usable',
      'vlan_broadcast', 'vlan_subnet_mask', 'vlan_lecturer_offset',
      'vlan_lecturer_range', 'device_interface_ip', 'vlan_id'
    ];

    if (!calc.calculationType || !validTypes.includes(calc.calculationType)) {
      errors.push(`${prefix}: calculationType must be one of: ${validTypes.join(', ')}`);
      return errors;
    }

    // Validate type-specific requirements
    const vlanBasedTypes = ['vlan_network_address', 'vlan_first_usable', 'vlan_last_usable',
                           'vlan_broadcast', 'vlan_subnet_mask', 'vlan_id'];

    if (vlanBasedTypes.includes(calc.calculationType)) {
      if (calc.vlanIndex === undefined || calc.vlanIndex < 0 || calc.vlanIndex > 9) {
        errors.push(`${prefix}: vlanIndex (0-9) is required for ${calc.calculationType}`);
      }
    }

    if (calc.calculationType === 'vlan_lecturer_offset') {
      if (!calc.lecturerOffset || calc.lecturerOffset < 1 || calc.lecturerOffset > 254) {
        errors.push(`${prefix}: lecturerOffset (1-254) is required for vlan_lecturer_offset`);
      }
      if (calc.vlanIndex === undefined || calc.vlanIndex < 0 || calc.vlanIndex > 9) {
        errors.push(`${prefix}: vlanIndex (0-9) is required for vlan_lecturer_offset`);
      }
    }

    if (calc.calculationType === 'vlan_lecturer_range') {
      if (!calc.lecturerRangeStart || calc.lecturerRangeStart < 1 || calc.lecturerRangeStart > 254) {
        errors.push(`${prefix}: lecturerRangeStart (1-254) is required for vlan_lecturer_range`);
      }
      if (!calc.lecturerRangeEnd || calc.lecturerRangeEnd < 1 || calc.lecturerRangeEnd > 254) {
        errors.push(`${prefix}: lecturerRangeEnd (1-254) is required for vlan_lecturer_range`);
      }
      if (calc.lecturerRangeStart && calc.lecturerRangeEnd && calc.lecturerRangeStart >= calc.lecturerRangeEnd) {
        errors.push(`${prefix}: lecturerRangeStart must be < lecturerRangeEnd`);
      }
      if (calc.vlanIndex === undefined || calc.vlanIndex < 0 || calc.vlanIndex > 9) {
        errors.push(`${prefix}: vlanIndex (0-9) is required for vlan_lecturer_range`);
      }
    }

    if (calc.calculationType === 'device_interface_ip') {
      if (!calc.deviceId) {
        errors.push(`${prefix}: deviceId is required for device_interface_ip`);
      }
      if (!calc.interfaceName) {
        errors.push(`${prefix}: interfaceName is required for device_interface_ip`);
      }
    }

    return errors;
  }

  /**
   * Validate DHCP configuration
   */
  static validateDhcpConfiguration(dhcp: any): string[] {
    const errors: string[] = [];

    if (dhcp.vlanIndex === undefined || dhcp.vlanIndex < 0 || dhcp.vlanIndex > 9) {
      errors.push('dhcpConfiguration.vlanIndex must be between 0-9');
    }
    if (!dhcp.startOffset || dhcp.startOffset < 1 || dhcp.startOffset > 254) {
      errors.push('dhcpConfiguration.startOffset must be between 1-254');
    }
    if (!dhcp.endOffset || dhcp.endOffset < 1 || dhcp.endOffset > 254) {
      errors.push('dhcpConfiguration.endOffset must be between 1-254');
    }
    if (dhcp.startOffset && dhcp.endOffset && dhcp.startOffset >= dhcp.endOffset) {
      errors.push('dhcpConfiguration.startOffset must be < endOffset');
    }
    if (!dhcp.dhcpServerDevice) {
      errors.push('dhcpConfiguration.dhcpServerDevice is required');
    }

    return errors;
  }
}
