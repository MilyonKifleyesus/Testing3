export interface TicketApiItem {
  id: number;
  ticketDescription?: string | null;
  projectId?: number | string | null;
  vehicleId?: number | string | null;
  defectLocationId?: number | string | null;
  defectLocationName?: string | null;
  createdAt?: string | null;
}

export interface TicketApiPage {
  items: TicketApiItem[];
  total: number;
  page: number | null;
  pageSize: number | null;
}

export interface DefectWordCloudBackendFilters {
  projectId?: string;
  defectLocationId?: string;
  vehicleId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface DefectWordCloudUiFilters {
  inspectionAreaId: string;
  selectedDefectKey: string;
  vehicleId: string;
  dateFrom: string;
  dateTo: string;
}

export interface WordCloudDatum {
  text: string;
  value: number;
  key: string;
}

export interface InspectionAreaOption {
  id: string;
  name: string;
}

export interface AggregatedWordCloudResult {
  words: WordCloudDatum[];
  totalTickets: number;
  validDescriptionCount: number;
  uniqueDescriptionCount: number;
}
