/**
 * M1 não fala com gateway. O PIX opcional só liga depois da M6 com dinheiro real.
 * O padrão fechado na D4 é pagar no local.
 */
export const defaultPaymentMode = "pay_at_location" as const;
