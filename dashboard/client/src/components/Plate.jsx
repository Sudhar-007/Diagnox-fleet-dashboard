// truck_id drawn as an Indian commercial (yellow) registration plate.
export default function Plate({ truckId, size = 'md' }) {
  const sizes = {
    sm: 'text-[11.5px] px-1.5 py-px',
    md: 'text-sm px-2 py-0.5',
    lg: 'text-lg px-2.5 py-0.5',
  };
  return (
    <span
      className={`inline-block rounded-[3px] border border-plate-ink/80 bg-plate font-display font-semibold leading-tight text-plate-ink shadow-[inset_0_0_0_2px_var(--color-plate),inset_0_0_0_3px_rgba(22,20,15,0.55)] ${sizes[size]}`}
    >
      {truckId}
    </span>
  );
}
