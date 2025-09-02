import { LabNetwork, ILabNetwork } from "./model";
import { Types } from "mongoose";

/**
 * Network Service - Business logic for lab network operations
 */
export class NetworkService {

  /**
   * Create a new lab network
   */
  static async createNetwork(networkData: any, createdBy: string) {
    try {
      const newNetwork = new LabNetwork({
        name: networkData.name,
        ipSchema: networkData.ipSchema,
        deviceMappings: networkData.deviceMappings || [],
        createdBy
      });

      const savedNetwork = await newNetwork.save();

      // Transform response to match frontend interface
      return {
        ...savedNetwork.toObject(),
        id: savedNetwork._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error creating network: ${(error as Error).message}`);
    }
  }

  /**
   * Get all networks with filtering and pagination
   */
  static async getAllNetworks(filters: {
    createdBy?: string;
    name?: string;
    page?: number;
    limit?: number;
  } = {}) {
    try {
      const { createdBy, name, page = 1, limit = 10 } = filters;
      const skip = (page - 1) * limit;

      // Build query filter
      const filter: any = {};
      if (createdBy) filter.createdBy = createdBy;
      if (name) filter.name = { $regex: name, $options: 'i' }; // Case-insensitive search

      const [networks, total] = await Promise.all([
        LabNetwork.find(filter)
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 })
          .lean(),
        LabNetwork.countDocuments(filter)
      ]);

      // Transform data to match frontend interface
      const transformedNetworks = networks.map(network => ({
        ...network,
        id: network._id?.toString(),
        _id: undefined
      }));

      return {
        networks: transformedNetworks,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      };
    } catch (error) {
      throw new Error(`Error fetching networks: ${(error as Error).message}`);
    }
  }

  /**
   * Get network by ID
   */
  static async getNetworkById(id: string) {
    try {
      const network = await LabNetwork.findById(id).lean();
      
      if (!network) {
        return null;
      }

      // Transform data to match frontend interface
      return {
        ...network,
        id: network._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error fetching network: ${(error as Error).message}`);
    }
  }

  /**
   * Update network by ID
   */
  static async updateNetwork(id: string, updateData: any) {
    try {
      // Filter out undefined values for partial updates
      const filteredData = Object.fromEntries(
        Object.entries(updateData).filter(([_, value]) => value !== undefined)
      );

      // Only allow updating specific fields
      const allowedFields = ['name', 'ipSchema', 'deviceMappings'];
      const updateFields: any = {};
      
      allowedFields.forEach(field => {
        if (filteredData[field] !== undefined) {
          updateFields[field] = filteredData[field];
        }
      });

      const updatedNetwork = await LabNetwork.findByIdAndUpdate(
        id,
        { $set: updateFields },
        { new: true, runValidators: true }
      );

      if (!updatedNetwork) {
        return null;
      }

      // Transform response to match frontend interface
      return {
        ...updatedNetwork.toObject(),
        id: updatedNetwork._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error updating network: ${(error as Error).message}`);
    }
  }

  /**
   * Delete network by ID
   */
  static async deleteNetwork(id: string) {
    try {
      const deletedNetwork = await LabNetwork.findByIdAndDelete(id);
      
      if (!deletedNetwork) {
        return null;
      }

      return {
        ...deletedNetwork.toObject(),
        id: deletedNetwork._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error deleting network: ${(error as Error).message}`);
    }
  }

  /**
   * Get networks by creator
   */
  static async getNetworksByCreator(createdBy: string, page: number = 1, limit: number = 10) {
    try {
      const skip = (page - 1) * limit;

      const [networks, total] = await Promise.all([
        LabNetwork.find({ createdBy })
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 })
          .lean(),
        LabNetwork.countDocuments({ createdBy })
      ]);

      // Transform data to match frontend interface
      const transformedNetworks = networks.map(network => ({
        ...network,
        id: network._id?.toString(),
        _id: undefined
      }));

      return {
        networks: transformedNetworks,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      };
    } catch (error) {
      throw new Error(`Error fetching networks for creator: ${(error as Error).message}`);
    }
  }

  /**
   * Get network statistics
   */
  static async getNetworkStatistics(createdBy?: string) {
    try {
      const filter = createdBy ? { createdBy } : {};

      const [
        totalNetworks,
        totalDevices,
        avgDevicesPerNetwork
      ] = await Promise.all([
        LabNetwork.countDocuments(filter),
        LabNetwork.aggregate([
          { $match: filter },
          { $project: { deviceCount: { $size: "$deviceMappings" } } },
          { $group: { _id: null, total: { $sum: "$deviceCount" } } }
        ]).then(result => result[0]?.total || 0),
        LabNetwork.aggregate([
          { $match: filter },
          { $project: { deviceCount: { $size: "$deviceMappings" } } },
          { $group: { _id: null, avgDevices: { $avg: "$deviceCount" } } }
        ]).then(result => Math.round(result[0]?.avgDevices || 0))
      ]);

      return {
        totalNetworks,
        totalDevices,
        avgDevicesPerNetwork
      };
    } catch (error) {
      throw new Error(`Error fetching network statistics: ${(error as Error).message}`);
    }
  }

  /**
   * Validate IP schema format
   */
  static validateIpSchema(ipSchema: any): boolean {
    try {
      // Basic validation - ensure it's an object and has required fields
      if (!ipSchema || typeof ipSchema !== 'object') {
        return false;
      }
      
      // You can add more specific validation based on your IP schema requirements
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate device mappings format
   */
  static validateDeviceMappings(deviceMappings: any[]): boolean {
    try {
      if (!Array.isArray(deviceMappings)) {
        return false;
      }
      
      // You can add more specific validation based on your device mapping requirements
      return true;
    } catch (error) {
      return false;
    }
  }
}
