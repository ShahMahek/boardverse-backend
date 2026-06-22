import sql from "../config/database";

export const executeQuery = async (
  query: string,
  params?: { name: string; value: any }[]
) => {
  const request = new sql.Request();

  if (params) {
    params.forEach((param) => {
      request.input(param.name, param.value);
    });
  }

  const result = await request.query(query);

  return result.recordset;
};