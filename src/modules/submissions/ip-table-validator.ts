/**
 * IP Table Questionnaire Validation Service
 * Validates student answers against lecturer-defined expected answers
 * Supports static answers, calculated exact IPs, and calculated IP ranges
 */

import { ILab } from '../labs/model';
import { ILabPart } from '../parts/model';
import { StudentLabSessionService } from '../student-lab-sessions/service';
import { IPGenerator } from './ip-generator';
import {
  calculateAdvancedStudentIP,
  calculateStudentIdBasedIP
} from './ip-calculator';
import { Types } from 'mongoose';

// Helper functions
function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function numberToIp(num: number): string {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255
  ].join('.');
}

interface SubnetDetails {
  networkAddress: string;
  firstUsableIp: string;
  lastUsableIp: string;
  broadcastAddress: string;
  subnetMask: number;
}

/**
 * Calculate subnet details for a VLAN considering student-specific calculations
 */
function calculateSubnetForVLAN(
  vlan: any,
  studentId: string
): SubnetDetails {
  if (vlan.calculationMultiplier !== undefined) {
    // For VLANs with calculationMultiplier, subnet properties are student-specific
    const baseIp = calculateAdvancedStudentIP(
      studentId,
      {
        baseNetwork: vlan.baseNetwork,
        calculationMultiplier: vlan.calculationMultiplier,
        subnetMask: vlan.subnetMask,
        subnetIndex: vlan.subnetIndex
      },
      0
    );

    // Extract network portion by applying subnet mask
    const baseIpNum = ipToNumber(baseIp);
    const maskBits = vlan.subnetMask;
    const blockSize = Math.pow(2, 32 - maskBits);

    // Calculate network address
    const networkNum = Math.floor(baseIpNum / blockSize) * blockSize;

    return {
      networkAddress: numberToIp(networkNum),
      firstUsableIp: numberToIp(networkNum + 1),
      lastUsableIp: numberToIp(networkNum + blockSize - 2),
      broadcastAddress: numberToIp(networkNum + blockSize - 1),
      subnetMask: maskBits
    };
  } else {
    // For fixed VLANs, subnet properties are the same for all students
    const blockSize = Math.pow(2, 32 - vlan.subnetMask);
    const baseNum = ipToNumber(vlan.baseNetwork);
    const networkNum = baseNum + (vlan.subnetIndex * blockSize);

    return {
      networkAddress: numberToIp(networkNum),
      firstUsableIp: numberToIp(networkNum + 1),
      lastUsableIp: numberToIp(networkNum + blockSize - 2),
      broadcastAddress: numberToIp(networkNum + blockSize - 1),
      subnetMask: vlan.subnetMask
    };
  }
}

interface CellValidationResult {
  isCorrect: boolean;
  pointsEarned: number;
  correctAnswer?: string;
}

/**
 * Validate a single table cell answer
 */
export async function validateTableCell(
  studentAnswer: string,
  cell: any,
  lab: ILab,
  studentId: string
): Promise<CellValidationResult> {

  // === STATIC ANSWERS ===
  if (cell.answerType === 'static') {
    const isCorrect = studentAnswer.trim().toLowerCase() ===
                     cell.staticAnswer!.trim().toLowerCase();
    return {
      isCorrect,
      pointsEarned: isCorrect ? cell.points : 0,
      correctAnswer: isCorrect ? undefined : cell.staticAnswer
    };
  }

  // === CALCULATED ANSWERS ===
  const calc = cell.calculatedAnswer!;

  // Get student's management IP and generate mappings
  const session = await StudentLabSessionService.getOrCreateSession(
    studentId,
    lab._id as Types.ObjectId,
    lab
  );
  const managementIp = session.managementIp;
  const ipMappings = IPGenerator.generateIPMappings(lab, studentId, managementIp);
  const vlanMappings = IPGenerator.generateVLANMappings(lab, studentId);

  let expectedAnswer: string | { min: string; max: string };
  let isRange = false;

  switch (calc.calculationType) {
    // === VLAN SUBNET PROPERTIES ===
    case 'vlan_network_address': {
      const vlan = lab.network.vlanConfiguration!.vlans[calc.vlanIndex!];
      const subnet = calculateSubnetForVLAN(vlan, studentId);
      expectedAnswer = subnet.networkAddress;
      break;
    }

    case 'vlan_first_usable': {
      const vlan = lab.network.vlanConfiguration!.vlans[calc.vlanIndex!];
      const subnet = calculateSubnetForVLAN(vlan, studentId);
      expectedAnswer = subnet.firstUsableIp;
      break;
    }

    case 'vlan_last_usable': {
      const vlan = lab.network.vlanConfiguration!.vlans[calc.vlanIndex!];
      const subnet = calculateSubnetForVLAN(vlan, studentId);
      expectedAnswer = subnet.lastUsableIp;
      break;
    }

    case 'vlan_broadcast': {
      const vlan = lab.network.vlanConfiguration!.vlans[calc.vlanIndex!];
      const subnet = calculateSubnetForVLAN(vlan, studentId);
      expectedAnswer = subnet.broadcastAddress;
      break;
    }

    case 'vlan_subnet_mask': {
      const vlan = lab.network.vlanConfiguration!.vlans[calc.vlanIndex!];
      expectedAnswer = vlan.subnetMask.toString();
      break;
    }

    // ⭐ === LECTURER-DEFINED EXACT OFFSET ===
    case 'vlan_lecturer_offset': {
      const vlan = lab.network.vlanConfiguration!.vlans[calc.vlanIndex!];

      if (vlan.calculationMultiplier !== undefined) {
        // Use advanced algorithm with lecturer's offset
        expectedAnswer = calculateAdvancedStudentIP(
          studentId,
          {
            baseNetwork: vlan.baseNetwork,
            calculationMultiplier: vlan.calculationMultiplier,
            subnetMask: vlan.subnetMask,
            subnetIndex: vlan.subnetIndex
          },
          calc.lecturerOffset!
        );
      } else {
        // Use basic algorithm with lecturer's offset
        expectedAnswer = calculateStudentIdBasedIP(
          vlan.baseNetwork,
          studentId,
          calc.lecturerOffset!
        );
      }
      break;
    }

    // ⭐ === LECTURER-DEFINED RANGE (DHCP POOLS) ===
    case 'vlan_lecturer_range': {
      const vlan = lab.network.vlanConfiguration!.vlans[calc.vlanIndex!];
      isRange = true;

      let minIp: string;
      let maxIp: string;

      if (vlan.calculationMultiplier !== undefined) {
        // Use advanced algorithm for range boundaries
        minIp = calculateAdvancedStudentIP(
          studentId,
          {
            baseNetwork: vlan.baseNetwork,
            calculationMultiplier: vlan.calculationMultiplier,
            subnetMask: vlan.subnetMask,
            subnetIndex: vlan.subnetIndex
          },
          calc.lecturerRangeStart!
        );

        maxIp = calculateAdvancedStudentIP(
          studentId,
          {
            baseNetwork: vlan.baseNetwork,
            calculationMultiplier: vlan.calculationMultiplier,
            subnetMask: vlan.subnetMask,
            subnetIndex: vlan.subnetIndex
          },
          calc.lecturerRangeEnd!
        );
      } else {
        // Use basic algorithm for range boundaries
        minIp = calculateStudentIdBasedIP(
          vlan.baseNetwork,
          studentId,
          calc.lecturerRangeStart!
        );

        maxIp = calculateStudentIdBasedIP(
          vlan.baseNetwork,
          studentId,
          calc.lecturerRangeEnd!
        );
      }

      expectedAnswer = { min: minIp, max: maxIp };
      break;
    }

    // === DEVICE INTERFACE IPs ===
    case 'device_interface_ip': {
      const key = `${calc.deviceId}.${calc.interfaceName}`;
      expectedAnswer = ipMappings[key]?.ip || '';
      break;
    }

    // === VLAN IDs ===
    case 'vlan_id': {
      const vlanKey = `vlan${calc.vlanIndex}`;
      expectedAnswer = vlanMappings[vlanKey]?.toString() || '';
      break;
    }

    default: {
      throw new Error(`Unknown calculation type: ${calc.calculationType}`);
    }
  }

  // === VALIDATION ===
  let isCorrect = false;
  let correctAnswerStr: string | undefined;

  // Determine if this is a range validation based on calculation type
  const isRangeValidation = cell.calculatedAnswer?.calculationType === 'vlan_lecturer_range';

  if (isRangeValidation && typeof expectedAnswer !== 'string') {
    // Range validation (DHCP pools)
    const studentIpNum = ipToNumber(studentAnswer);
    const minNum = ipToNumber(expectedAnswer.min);
    const maxNum = ipToNumber(expectedAnswer.max);

    isCorrect = studentIpNum >= minNum && studentIpNum <= maxNum;
    correctAnswerStr = isCorrect ? undefined : `${expectedAnswer.min} - ${expectedAnswer.max}`;
  } else {
    // Exact match validation
    isCorrect = typeof expectedAnswer === 'string' &&
               studentAnswer.trim().toLowerCase() ===
               expectedAnswer.trim().toLowerCase();
    correctAnswerStr = isCorrect ? undefined : (expectedAnswer as string);
  }

  return {
    isCorrect,
    pointsEarned: isCorrect ? cell.points : 0,
    correctAnswer: correctAnswerStr
  };
}

interface TableValidationResult {
  questionId: string;
  isCorrect: boolean;
  pointsEarned: number;
  feedback?: string;
  cellResults: Array<Array<{
    isCorrect: boolean;
    pointsEarned: number;
    correctAnswer?: string;
  }>>;
}

/**
 * Validate entire IP Table Questionnaire
 */
export async function validateIpTableQuestionnaire(
  question: any,
  studentTableAnswers: string[][],
  lab: ILab,
  studentId: string
): Promise<TableValidationResult> {

  const table = question.ipTableQuestionnaire;
  const cellResults: Array<Array<any>> = [];
  let totalCellPoints = 0;
  let earnedCellPoints = 0;

  // Validate each cell
  for (let rowIdx = 0; rowIdx < table.rowCount; rowIdx++) {
    cellResults[rowIdx] = [];
    for (let colIdx = 0; colIdx < table.columnCount; colIdx++) {
      const cell = table.cells[rowIdx][colIdx];
      const studentAnswer = studentTableAnswers[rowIdx][colIdx];

      // Validate cell
      const result = await validateTableCell(
        studentAnswer,
        cell,
        lab,
        studentId
      );

      totalCellPoints += cell.points;
      earnedCellPoints += result.pointsEarned;

      cellResults[rowIdx][colIdx] = {
        isCorrect: result.isCorrect,
        pointsEarned: result.pointsEarned,
        correctAnswer: result.correctAnswer
      };
    }
  }

  // Overall question result
  const isCorrect = earnedCellPoints === totalCellPoints;

  return {
    questionId: question.questionId,
    isCorrect,
    pointsEarned: earnedCellPoints,
    cellResults,
    feedback: isCorrect
      ? 'All table cells correct!'
      : `${earnedCellPoints}/${totalCellPoints} points earned`
  };
}
