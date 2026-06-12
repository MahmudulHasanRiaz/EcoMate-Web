"use client";

import Image from 'next/image';
import { X } from 'lucide-react';

export interface SizeChartData {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  tableData: Record<string, string>[] | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  sizeChart: SizeChartData | null;
}

export function SizeChartModal({ open, onClose, sizeChart }: Props) {
  if (!open || !sizeChart) return null;

  const tableData = sizeChart.tableData;
  const hasTableData = tableData !== null && tableData !== undefined && tableData.length > 0;
  const columns = hasTableData ? Object.keys(tableData[0]) : [];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="text-[16px] font-semibold">{sizeChart.name}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6">
          {sizeChart.description && <p className="text-[14px] text-gray-600 mb-4">{sizeChart.description}</p>}

          {sizeChart.image && (
            <Image src={sizeChart.image} alt={sizeChart.name} width={800} height={400} className="w-full max-h-[400px] object-contain mb-4 rounded-lg" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          )}

          {hasTableData && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    {columns.map(col => (
                      <th key={col} className="px-4 py-3 text-[13px] font-semibold text-gray-700 text-left border border-gray-200 capitalize">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row: Record<string, string>, i: number) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                      {columns.map(col => (
                        <td key={col} className="px-4 py-3 text-[13px] text-gray-600 border border-gray-200">{row[col]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
