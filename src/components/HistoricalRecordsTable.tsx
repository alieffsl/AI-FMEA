import { StatusBadge } from "./ui/StatusBadge";

type HistoricalRecord = {
  id: number;
  toy_num: string;
  toy_name: string;
  tool_num: string;
  tool_description: string;
  tool_category: string | null;
  material_gate: string;
  failure_mode: string;
  learning: string;
  final_recommendation: string;
  status: string;
  created_at: string;
};

type HistoricalRecordsTableProps = {
  records: HistoricalRecord[];
};

export function HistoricalRecordsTable({ records }: HistoricalRecordsTableProps) {
  if (records.length === 0) {
    return (
      <div className="text-sm text-steel-400 italic py-4 text-center bg-steel-50 rounded-lg border border-steel-200">
        No historical records found
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-blue-200 bg-white">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-blue-50">
            <tr className="border-b border-blue-200">
              <th className="px-3 py-2 text-left font-semibold text-blue-900">Toy / Tool</th>
              <th className="px-3 py-2 text-left font-semibold text-blue-900">Material</th>
              <th className="px-3 py-2 text-left font-semibold text-blue-900">What Went Wrong</th>
              <th className="px-3 py-2 text-left font-semibold text-blue-900">What Was Done</th>
              <th className="px-3 py-2 text-center font-semibold text-blue-900">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-100">
            {records.map((record) => (
              <tr key={record.id} className="hover:bg-blue-50/30 transition-colors">
                <td className="px-3 py-2.5 align-top">
                  <div className="font-semibold text-steel-900">{record.toy_num}</div>
                  <div className="text-[10px] text-steel-500 mt-0.5">{record.tool_description}</div>
                </td>
                <td className="px-3 py-2.5 align-top text-steel-600 whitespace-nowrap">
                  {record.material_gate}
                </td>
                <td className="px-3 py-2.5 align-top text-steel-700 max-w-md">
                  {record.learning}
                </td>
                <td className="px-3 py-2.5 align-top text-steel-700 max-w-md">
                  {record.final_recommendation}
                </td>
                <td className="px-3 py-2.5 align-top text-center">
                  <StatusBadge status={record.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-steel-500 text-right py-1">
        {records.length} record{records.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
