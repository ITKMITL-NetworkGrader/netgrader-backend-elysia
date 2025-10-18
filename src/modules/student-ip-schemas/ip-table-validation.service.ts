/**
 * IP Table Questionnaire Validation Service
 *
 * Handles validation of IP table questionnaire answers with support for
 * both static and calculated answer types.
 */

import { ILabPart } from '../parts/model';
import { ILab } from '../labs/model';
import { IStudentIpSchema } from './model';
import {
  ipToNumber,
  numberToIp,
  isIpInRange,
  isValidIpAddress,
  calculateSubnet,
  getHostIp
} from './ip-calculation.service';

export interface CellValidationResult {
  isCorrect: boolean;
  pointsEarned: number;
  correctAnswer?: string;  // Only provided if incorrect
}

export interface TableValidationResult {
  questionId: string;
  isCorrect: boolean;
  pointsEarned: number;
  feedback?: string;
  cellResults: CellValidationResult[][];
}

/**
 * Validate IP table questionnaire answers
 *
 * @param questionId - Question ID
 * @param tableAnswers - 2D array of student answers
 * @param question - Question definition from LabPart
 * @param lab - Lab configuration
 * @param studentIpSchema - Student's IP schema (optional, for device interface lookups)
 * @returns Validation result with cell-by-cell breakdown
 */
export function validateIpTableQuestionnaire(
  questionId: string,
  tableAnswers: string[][],
  question: any,
  lab: ILab,
  studentIpSchema?: IStudentIpSchema
): TableValidationResult {
  if (!question.ipTableQuestionnaire) {
    throw new Error(`Question ${questionId} is not an IP table questionnaire`);
  }

  const { ipTableQuestionnaire } = question;
  const cellResults: CellValidationResult[][] = [];
  let totalPointsEarned = 0;
  let totalCellsCorrect = 0;
  let totalCells = 0;

  // Validate each cell
  for (let rowIdx = 0; rowIdx < ipTableQuestionnaire.rowCount; rowIdx++) {
    const rowResults: CellValidationResult[] = [];

    for (let colIdx = 0; colIdx < ipTableQuestionnaire.columnCount; colIdx++) {
      const cell = ipTableQuestionnaire.cells[rowIdx][colIdx];
      const studentAnswer = tableAnswers[rowIdx][colIdx];

      const cellResult = validateCell(
        studentAnswer,
        cell,
        lab,
        studentIpSchema
      );

      rowResults.push(cellResult);
      totalPointsEarned += cellResult.pointsEarned;
      totalCells++;
      if (cellResult.isCorrect) {
        totalCellsCorrect++;
      }
    }

    cellResults.push(rowResults);
  }

  // Calculate total points for question
  const totalPoints = ipTableQuestionnaire.cells.flat().reduce(
    (sum: number, cell: any) => sum + cell.points,
    0
  );

  const isCorrect = totalPointsEarned === totalPoints;
  const feedback = `${totalPointsEarned}/${totalPoints} points earned (${totalCellsCorrect}/${totalCells} cells correct)`;

  return {
    questionId,
    isCorrect,
    pointsEarned: totalPointsEarned,
    feedback,
    cellResults
  };
}

/**
 * Validate a single cell answer
 *
 * @param studentAnswer - Student's answer for this cell
 * @param cell - Cell configuration
 * @param lab - Lab configuration
 * @param studentIpSchema - Student's IP schema (optional)
 * @returns Cell validation result
 */
function validateCell(
  studentAnswer: string,
  cell: any,
  lab: ILab,
  studentIpSchema?: IStudentIpSchema
): CellValidationResult {
  const normalizedAnswer = normalizeAnswer(studentAnswer);

  if (cell.answerType === 'static') {
    // Static answer: simple string comparison
    const normalizedExpected = normalizeAnswer(cell.staticAnswer);
    const isCorrect = normalizedAnswer === normalizedExpected;

    return {
      isCorrect,
      pointsEarned: isCorrect ? cell.points : 0,
      correctAnswer: isCorrect ? undefined : cell.staticAnswer
    };
  } else if (cell.answerType === 'calculated') {
    // Calculated answer: resolve dynamically based on calculation type
    return validateCalculatedCell(
      normalizedAnswer,
      cell,
      lab,
      studentIpSchema
    );
  }

  throw new Error(`Invalid answer type: ${cell.answerType}`);
}

/**
 * Validate a calculated cell answer
 *
 * @param studentAnswer - Normalized student answer
 * @param cell - Cell configuration
 * @param lab - Lab configuration
 * @param studentIpSchema - Student's IP schema
 * @returns Cell validation result
 */
function validateCalculatedCell(
  studentAnswer: string,
  cell: any,
  lab: ILab,
  studentIpSchema?: IStudentIpSchema
): CellValidationResult {
  const { calculatedAnswer } = cell;
  const { calculationType, vlanIndex } = calculatedAnswer;

  // Get VLAN configuration
  const vlan = lab.network.vlanConfiguration?.vlans[vlanIndex];
  if (!vlan && calculationType !== 'vlan_id') {
    throw new Error(`VLAN ${vlanIndex} not found in lab configuration`);
  }

  let expectedAnswer: string | null = null;
  let isRange = false;
  let rangeStart: string | null = null;
  let rangeEnd: string | null = null;

  switch (calculationType) {
    case 'vlan_network_address': {
      if (!vlan) throw new Error(`VLAN not found for index ${vlanIndex}`);
      const subnet = calculateSubnet(vlan.baseNetwork, vlan.subnetMask, vlan.subnetIndex);
      expectedAnswer = subnet.networkAddress;
      break;
    }

    case 'vlan_first_usable': {
      if (!vlan) throw new Error(`VLAN not found for index ${vlanIndex}`);
      const subnet = calculateSubnet(vlan.baseNetwork, vlan.subnetMask, vlan.subnetIndex);
      expectedAnswer = subnet.firstUsableIp;
      break;
    }

    case 'vlan_last_usable': {
      if (!vlan) throw new Error(`VLAN not found for index ${vlanIndex}`);
      const subnet = calculateSubnet(vlan.baseNetwork, vlan.subnetMask, vlan.subnetIndex);
      expectedAnswer = subnet.lastUsableIp;
      break;
    }

    case 'vlan_broadcast': {
      if (!vlan) throw new Error(`VLAN not found for index ${vlanIndex}`);
      const subnet = calculateSubnet(vlan.baseNetwork, vlan.subnetMask, vlan.subnetIndex);
      expectedAnswer = subnet.broadcastAddress;
      break;
    }

    case 'vlan_subnet_mask': {
      if (!vlan) throw new Error(`VLAN not found for index ${vlanIndex}`);
      expectedAnswer = vlan.subnetMask.toString();
      break;
    }

    case 'vlan_lecturer_offset': {
      if (!vlan) throw new Error(`VLAN not found for index ${vlanIndex}`);
      const subnet = calculateSubnet(vlan.baseNetwork, vlan.subnetMask, vlan.subnetIndex);
      expectedAnswer = getHostIp(subnet, calculatedAnswer.lecturerOffset);
      break;
    }

    case 'vlan_lecturer_range': {
      if (!vlan) throw new Error(`VLAN not found for index ${vlanIndex}`);
      isRange = true;
      const subnet = calculateSubnet(vlan.baseNetwork, vlan.subnetMask, vlan.subnetIndex);
      rangeStart = getHostIp(subnet, calculatedAnswer.lecturerRangeStart);
      rangeEnd = getHostIp(subnet, calculatedAnswer.lecturerRangeEnd);
      break;
    }

    case 'device_interface_ip': {
      if (!studentIpSchema) {
        throw new Error('Student IP schema required for device_interface_ip validation');
      }

      const device = studentIpSchema.schema.devices.find(
        d => d.deviceId === calculatedAnswer.deviceId
      );
      if (!device) {
        throw new Error(`Device ${calculatedAnswer.deviceId} not found in student schema`);
      }

      const iface = device.interfaces.find(
        i => i.variableName === calculatedAnswer.interfaceName
      );
      if (!iface) {
        throw new Error(
          `Interface ${calculatedAnswer.interfaceName} not found on device ${calculatedAnswer.deviceId}`
        );
      }

      expectedAnswer = iface.ipAddress;
      break;
    }

    case 'vlan_id': {
      if (!vlan) throw new Error(`VLAN not found for index ${vlanIndex}`);
      expectedAnswer = vlan.vlanId?.toString() || '';
      break;
    }

    default:
      throw new Error(`Unsupported calculation type: ${calculationType}`);
  }

  // Validate answer
  let isCorrect = false;

  if (isRange && rangeStart && rangeEnd) {
    // Range validation
    if (isValidIpAddress(studentAnswer)) {
      isCorrect = isIpInRange(studentAnswer, rangeStart, rangeEnd);
    }
    expectedAnswer = `${rangeStart} - ${rangeEnd}`;
  } else if (expectedAnswer) {
    // Exact match validation
    isCorrect = studentAnswer === normalizeAnswer(expectedAnswer);
  }

  return {
    isCorrect,
    pointsEarned: isCorrect ? cell.points : 0,
    correctAnswer: isCorrect ? undefined : (expectedAnswer || undefined)
  };
}

/**
 * Normalize answer for comparison
 * - Trim whitespace
 * - Convert to lowercase
 * - Remove extra spaces
 *
 * @param answer - Answer string
 * @returns Normalized answer
 */
function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/g, ' ');
}
