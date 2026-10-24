export interface AddressCreateRequest {
  recipient_name: string;
  recipient_phone: string;
  province: string;
  city: string;
  district: string;
  detail_address: string;
  is_default?: boolean;
}

export interface Address extends AddressCreateRequest {
  address_id: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  edit_token: string;
}

export interface AddressGateway {
  read(): Promise<Address[]>;
  create(request: AddressCreateRequest, key: string): Promise<Address>;
}
