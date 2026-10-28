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

// Editing sends contact fields only; default selection is a separate operation.
export interface AddressEditRequest extends Omit<AddressCreateRequest, 'is_default'> {
  edit_token: string;
}

export interface AddressDeleteResult {
  deleted: true;
}

export type AddressOperation =
  | { kind: 'create'; request: AddressCreateRequest }
  | { kind: 'update'; address_id: string; request: AddressEditRequest }
  | { kind: 'set-default'; address_id: string }
  | { kind: 'delete'; address_id: string };

export interface AddressGateway {
  read(): Promise<Address[]>;
  create(request: AddressCreateRequest, key: string): Promise<Address>;
  update(addressId: string, request: AddressEditRequest, operationKey: string): Promise<Address>;
  setDefault(addressId: string, key: string): Promise<Address>;
  remove(addressId: string, key: string): Promise<AddressDeleteResult>;
}
