import { Node as WarRoomNode } from '../../../../models/fluorescence-map.interface';

export type MarkerNodeType = 'client' | 'factory' | 'subsidiary' | 'parent';

export interface MarkerVm {
    id: string; // Internal unique ID
    node: WarRoomNode; // Reference to original data
    nodeType: MarkerNodeType;
    isCluster: boolean;
    displayName: string;
    shortName: string;
    subLabel: string;
    initials: string;
    hasLogo: boolean;
    logoPath: string;
    isSelected: boolean;
    isHovered: boolean;
    isHub: boolean;
    isHQ: boolean;
    statusKey: 'online' | 'offline';
    statusColor: string;
    statusGlow: string;
    projectStatusColor: string;
    statusIconPath: string;
    lodClass: 'lod-low' | 'lod-medium' | 'lod-high';
    isPinned: boolean;
    anchor: { width: number; height: number; centerX: number; centerY: number };
    pinScale: number;
    showPinLabel: boolean;
    /** When set, used for marker position so it aligns with route line endpoints. */
    displayCoordinates?: { longitude: number; latitude: number };
}
