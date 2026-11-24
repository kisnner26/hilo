import { preguntarAlAgente, type PedidoAgente } from '../lib/agente';

/** Botón pequeño y uniforme para preguntarle algo al agente desde cualquier pantalla. */
export function PreguntarAgente({ pedido, etiqueta = 'Preguntar al agente', clase = 'boton secundario' }: { pedido: PedidoAgente; etiqueta?: string; clase?: string }) {
  return (
    <button className={`${clase} con-chispa`} onClick={() => preguntarAlAgente(pedido)} title="Abre el Asistente con esta pregunta">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      </svg>
      {etiqueta}
    </button>
  );
}
