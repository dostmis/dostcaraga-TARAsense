export enum Role {
  ADMIN = 'ADMIN',
  MSME = 'MSME',
  FIC = 'FIC',
  CONSUMER = 'CONSUMER',
  RESEARCHER = 'RESEARCHER',
  FIC_MANAGER = 'FIC_MANAGER',
}

export const ROLE_ALIASES: Record<Role, Role[]> = {
  [Role.ADMIN]: [Role.ADMIN],
  [Role.MSME]: [Role.MSME],
  [Role.FIC]: [Role.FIC, Role.FIC_MANAGER],
  [Role.CONSUMER]: [Role.CONSUMER, Role.RESEARCHER],
  [Role.RESEARCHER]: [Role.RESEARCHER],
  [Role.FIC_MANAGER]: [Role.FIC_MANAGER],
};
