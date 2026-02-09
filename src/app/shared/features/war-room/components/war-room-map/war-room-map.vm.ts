import { Node as WarRoomNode } from '../../../../models/war-room.interface';

export interface MarkerVm {
    id: string; // Internal unique ID
    node: WarRoomNode; // Reference to original data
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
    statusIconPath: string;
    lodClass: 'lod-low' | 'lod-medium' | 'lod-high';
    isPinned: boolean;
    pinTransform: string; // translate(x, y)
    pinScale: number;
    showPinLabel: boolean;
    /** When set, used for marker position so it aligns with route line endpoints. */
    displayCoordinates?: { longitude: number; latitude: number };
}
