import { notFound } from 'next/navigation';

export default async function DesignSystemPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { default: DesignSystemLab } = await import('@/components/design-system/DesignSystemLab');
  return <DesignSystemLab />;
}
