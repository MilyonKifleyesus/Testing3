/**
 * Seed data from spreadsheet: Company Name + Full Street Address
 * Parse into Company + Location entities for import
 */

export interface CompanyAddressSeed {
  companyName: string;
  fullStreetAddress: string;
}

/** 30 companies with full addresses from spreadsheet */
export const COMPANY_ADDRESSES_SEED: CompanyAddressSeed[] = [
  { companyName: 'York Region Transit', fullStreetAddress: '50 High Tech Rd, Richmond Hill, ON L4B 4N7, Canada' },
  { companyName: 'Toronto Transit Commission', fullStreetAddress: '1900 Yonge St, Toronto, ON M4S 1Z2, Canada' },
  { companyName: 'TransLink', fullStreetAddress: "400-287 Nelson's Ct, New Westminster, BC V3L 0E7, Canada" },
  { companyName: 'MTA', fullStreetAddress: '2 Broadway, New York, NY 10004, USA' },
  { companyName: 'RTD Denver', fullStreetAddress: '1600 Blake St, Denver, CO 80202, USA' },
  { companyName: 'Arlington Transit', fullStreetAddress: '2100 Clarendon Blvd, Arlington, VA 22201, USA' },
  { companyName: 'Monterey-Salinas Transit', fullStreetAddress: '19 Upper Ragsdale Dr, Monterey, CA 93940, USA' },
  { companyName: 'HASTUS (GIRO Inc.)', fullStreetAddress: '700 Blvd René-Lévesque O, Montréal, QC H3B 5K2, Canada' },
  { companyName: 'SP+', fullStreetAddress: '200 E Randolph St, Chicago, IL 60601, USA' },
  { companyName: 'Electromin', fullStreetAddress: 'Prince Sultan Rd, Jeddah, Saudi Arabia' },
  { companyName: 'Innergex', fullStreetAddress: '400-1188 Georgia St W, Vancouver, BC V6E 4A2, Canada' },
  { companyName: 'Gazzola Paving', fullStreetAddress: '123 Main St, North Bay, ON, Canada' },
  { companyName: 'Enbridge', fullStreetAddress: '200 Fifth Ave SW, Calgary, AB T2P 2L7, Canada' },
  { companyName: 'AUX Energy', fullStreetAddress: '100 Innovation Dr, Ajax, ON, Canada' },
  { companyName: 'CAMSC', fullStreetAddress: '200 Consumers Rd, Toronto, ON M2J 4R4, Canada' },
  { companyName: 'City of Fairfield', fullStreetAddress: '1000 Webster St, Fairfield, CA 94533, USA' },
  { companyName: 'City of Abbotsford', fullStreetAddress: '32315 South Fraser Way, Abbotsford, BC V2T 1W7, Canada' },
  { companyName: 'Dufferin County', fullStreetAddress: '30 Centre St, Orangeville, ON L9W 2X1, Canada' },
  { companyName: 'Mount Sinai Hospital', fullStreetAddress: '600 University Ave, Toronto, ON M5G 1X5, Canada' },
  { companyName: 'GO Transit', fullStreetAddress: '20 Bay St, Toronto, ON M5J 2N8, Canada' },
  { companyName: 'MiWay', fullStreetAddress: '500 Burnhamthorpe Rd W, Mississauga, ON L5B 3C3, Canada' },
  { companyName: 'Brampton Transit', fullStreetAddress: '150 Central Park Dr, Brampton, ON L6T 2P7, Canada' },
  { companyName: 'OC Transpo', fullStreetAddress: '1500 St Laurent Blvd, Ottawa, ON K1G 0Z8, Canada' },
  { companyName: 'STO (Gatineau)', fullStreetAddress: '111 Jean-Proulx E, Gatineau, QC J8Z 1W4, Canada' },
  { companyName: 'DRT', fullStreetAddress: '605 Rossland Rd E, Whitby, ON L1N 9G3, Canada' },
  { companyName: 'New Flyer', fullStreetAddress: '711 Kernaghan Ave, Winnipeg, MB R2C 3E4, Canada' },
  { companyName: 'Nova Bus', fullStreetAddress: '500 Industrial Blvd, Saint-Eustache, QC J7R 5R3, Canada' },
  { companyName: 'ARBOC', fullStreetAddress: '901 W 7th St, Middlebury, IN 46540, USA' },
  { companyName: 'ENC', fullStreetAddress: '2420 E Riverside Dr, Riverside, CA 92507, USA' },
  { companyName: 'Karsan', fullStreetAddress: 'Atatürk Mah. 1023. Sok. No:12, Bursa, Turkey' },
];
